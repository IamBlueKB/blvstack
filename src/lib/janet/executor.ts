// The unified send executor (Phase 2.1) — the ONE gated send path.
//
// Every email — chat, manual, batch, cron, booker, PSRx — routes through
// sendVerified(). It:
//   • REFUSES to send without a valid approval_ref (the transport itself is
//     gated, not just the tool path — this closes the unattended cron lane).
//   • is IDEMPOTENT by a client-generated key (a retry after an ambiguous
//     failure can't double-send).
//   • makes the single provider call, writes the ONE sent-log (janet_sent_emails),
//     and drives the action ledger (proposed→approved→executed→…→failed/refused).
//   • NEVER reports success on a provider error — the ledger goes to 'failed' and
//     the caller gets ok:false (this is the E-fix at the transport layer).
//
// Templating + which Resend account stay with the caller (lanes differ); the
// executor owns the gate, the ledger, and the log. Read-after-write verification
// (2.3) is the only thing that moves a row to 'verified'.

import { supabaseAdmin } from '../supabase';
import { recordSentEmail, type RecordSentEmailInput } from './sent';
import { verifySend } from './verify';

export type SendLane = 'chat' | 'manual' | 'batch' | 'cron' | 'booker' | 'psrx';

// Lanes whose sending key can read messages back (full-access Resend account).
// chat + manual use the blvstack.com send-only key (401 on emails.get), so their
// synchronous read-back is skipped — the delivery webhook confirms them instead.
const READ_BACK_LANES = new Set<SendLane>(['batch', 'cron', 'booker', 'psrx']);

/** Minimal shape of a Resend-like client — anything with emails.send(). Lets the
 *  caller pass whichever account's client, and lets tests inject a stub. */
export type EmailSender = {
  emails: {
    send: (args: any) => Promise<{ data?: { id?: string | null } | null; error?: any }>;
  };
};

export type SendVerifiedInput = {
  actionType: string; // 'send_email' | 'send_lead_reply' | 'send_message_reply' | 'outbound' | 'booker_pitch' | ...
  lane: SendLane;
  approvalRef: string | null; // REQUIRED — the executor refuses without it
  idempotencyKey: string; // dedup; a retry with the same key never re-sends
  message: {
    client: EmailSender;
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
  };
  // For the one sent-log (janet_sent_emails); resendId is filled by the executor.
  log: Omit<RecordSentEmailInput, 'resendId'>;
};

export type SendVerifiedResult = {
  ok: boolean;
  id: string | null; // provider (Resend) id
  error?: string;
  ledgerId: string | null;
  state: string; // approved | executed | verified | failed | refused | (dedup: prior state)
  dedup?: boolean;
  verified?: boolean; // true once the provider read-back (2.3) confirmed the message
  providerState?: string; // Resend last_event at read-back time
  verifyError?: string; // why verification didn't confirm (send still happened)
};

const now = () => new Date().toISOString();

async function ledgerInsert(row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('janet_action_ledger').insert(row).select('id').single();
  if (error) {
    console.error('[executor] ledger insert failed:', error.message);
    return null;
  }
  return (data as { id: string }).id;
}
async function ledgerUpdate(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from('janet_action_ledger').update({ ...patch, updated_at: now() }).eq('id', id);
  if (error) console.error('[executor] ledger update failed:', error.message);
}

export async function sendVerified(input: SendVerifiedInput): Promise<SendVerifiedResult> {
  const { actionType, lane, approvalRef, idempotencyKey, message, log } = input;
  const payload = { to: message.to, subject: message.subject, body: message.text ?? message.html ?? '', from: message.from };

  // 1. Idempotency — if this key already executed, return the prior result. Never re-send.
  const { data: existing } = await supabaseAdmin
    .from('janet_action_ledger')
    .select('id, state, result')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing && ['executed', 'verified', 'reported'].includes(existing.state)) {
    return { ok: true, id: (existing.result as any)?.id ?? null, ledgerId: existing.id, state: existing.state, dedup: true, verified: existing.state === 'verified' || existing.state === 'reported' };
  }

  // 2. REFUSE without an approval reference. The transport is gated.
  if (!approvalRef) {
    const base = { action_type: actionType, lane, idempotency_key: idempotencyKey, payload, state: 'refused', approval_ref: null, error: 'no approval reference' };
    const ledgerId = existing ? (await ledgerUpdate(existing.id, { state: 'refused', error: 'no approval reference' }), existing.id) : await ledgerInsert(base);
    return { ok: false, id: null, error: 'Refused: this send has no approval reference.', ledgerId, state: 'refused' };
  }

  // 3. Record approved intent.
  const ledgerId = existing
    ? (await ledgerUpdate(existing.id, { state: 'approved', approval_ref: approvalRef, error: null }), existing.id)
    : await ledgerInsert({ action_type: actionType, lane, idempotency_key: idempotencyKey, payload, state: 'approved', approval_ref: approvalRef });

  // 4. Execute — the ONE provider send. A failure NEVER becomes a success.
  try {
    const { data, error } = await message.client.emails.send({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });
    if (error) throw new Error(typeof error === 'string' ? error : error?.message ?? 'send failed');
    const resendId = data?.id ?? null;

    // 5. The one sent-log.
    const rec = await recordSentEmail({ ...log, resendId });
    if (ledgerId) await ledgerUpdate(ledgerId, { state: 'executed', result: { id: resendId }, sent_log_id: rec?.id ?? null, executed_at: now() });

    // 6. Read-after-write (2.3). 'verified' == DELIVERY confirmed. chat/manual use
    //    the blvstack.com send-only key, which can't read messages back (401), so we
    //    SKIP the doomed call for those lanes — their delivery is confirmed later by
    //    the Resend webhook, which promotes the ledger executed→verified. Full-key
    //    lanes read back now (catches a fabricated id / a fast bounce), but only reach
    //    'verified' if the provider ALREADY shows delivered; otherwise they too stay
    //    'executed' until the webhook lands. Either way, no false certainty.
    if (READ_BACK_LANES.has(lane)) {
      const v = await verifySend(message.client, resendId, ledgerId);
      return {
        ok: true, id: resendId, ledgerId,
        state: v.verified ? 'verified' : 'executed',
        verified: v.verified, providerState: v.providerState,
        verifyError: v.verified ? undefined : (v.error ?? (v.accepted ? 'accepted; delivery pending' : undefined)),
      };
    }
    return {
      ok: true, id: resendId, ledgerId, state: 'executed',
      verified: false, verifyError: 'delivery confirmation pending (webhook)',
    };
  } catch (e: any) {
    const err = e?.message ?? 'send failed';
    if (ledgerId) await ledgerUpdate(ledgerId, { state: 'failed', error: err });
    return { ok: false, id: null, error: err, ledgerId, state: 'failed' };
  }
}
