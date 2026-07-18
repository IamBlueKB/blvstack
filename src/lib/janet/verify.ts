// Phase 2.3 — read-after-write verification. A write only becomes 'verified' when
// an INDEPENDENT read confirms it:
//   • a send is confirmed by reading the provider's OWN record of the message
//     (Resend emails.get by id) — guards against a fabricated/empty id and against
//     a provider error that slipped through;
//   • a publish is confirmed by fetching the public URL and finding the page's own
//     content served there.
// ONLY that read moves a ledger row to 'verified'. "Done / verified" is a fact the
// system checks against reality, never a claim the model makes.

import { supabaseAdmin } from '../supabase';

const nowIso = () => new Date().toISOString();

// ── Send: read the message back from the provider ──────────────────────────
// 'verified' means DELIVERY confirmed, never merely "accepted". The synchronous
// read-back only reaches 'verified' if the provider ALREADY shows delivered
// (rare — usually the message is still queued/sent at send time). Otherwise the
// send stays 'executed' (fired, delivery pending) and the delivery WEBHOOK does
// the executed→verified promotion. Bad states (bounce/complaint) mark 'failed'.
export type SendVerification = { verified: boolean; accepted?: boolean; providerState?: string; error?: string };

const DELIVERED_STATE = 'delivered';
const FAILED_PROVIDER_STATES = new Set(['bounced', 'complained', 'failed', 'canceled']);

export async function verifySend(
  client: unknown,
  resendId: string | null,
  ledgerId: string | null
): Promise<SendVerification> {
  if (!resendId) return { verified: false, error: 'no provider id to read back' };
  // The real Resend client exposes emails.get; a test stub without it (or any
  // non-reading client) simply yields verified:false — never a false pass.
  const emails = (client as any)?.emails;
  const getFn = emails?.get;
  if (typeof getFn !== 'function') return { verified: false, error: 'provider client cannot read back' };
  try {
    const { data, error } = await getFn.call(emails, resendId);
    if (error) {
      // A send-only API key can't read messages back (Resend 401 restricted_api_key).
      // That's an inability to VERIFY, not evidence the send failed — keep the ledger
      // at 'executed' and say so distinctly, so it never reads as "message missing".
      const restricted = (error as any)?.name === 'restricted_api_key' || (error as any)?.statusCode === 401;
      return { verified: false, error: restricted ? 'read-back not permitted for the sending key (send-only)' : (error as any)?.message ?? 'provider read failed' };
    }
    if (!data?.id) return { verified: false, error: 'provider has no record of this id' };
    const providerState: string = data.last_event ?? 'sent';

    if (FAILED_PROVIDER_STATES.has(providerState)) {
      if (ledgerId) await setLedgerState(ledgerId, 'failed', { error: `provider state: ${providerState}` });
      return { verified: false, providerState, error: `provider state: ${providerState}` };
    }
    if (providerState === DELIVERED_STATE) {
      if (ledgerId) await setLedgerState(ledgerId, 'verified', { verified_at: nowIso(), result: { id: resendId, provider_state: providerState } });
      return { verified: true, accepted: true, providerState };
    }
    // Accepted by the provider (queued/sent/scheduled/…) but not yet delivered.
    // Stays 'executed'; the delivery webhook promotes it to 'verified'.
    return { verified: false, accepted: true, providerState };
  } catch (e: any) {
    return { verified: false, error: e?.message ?? 'verify read failed' };
  }
}

async function setLedgerState(ledgerId: string, state: string, extra: Record<string, unknown> = {}): Promise<void> {
  await supabaseAdmin
    .from('janet_action_ledger')
    .update({ state, updated_at: nowIso(), ...extra })
    .eq('id', ledgerId);
}

// ── Delivery webhook → ledger promotion (executed → verified on delivery) ───
// The delivery event is the independent confirmation for lanes whose sending key
// can't read back (chat/manual, send-only key) AND the delivery truth for the
// rest. Matched by the provider id we stored in the ledger's result.id. Idempotent
// and state-guarded so a stray event can't move a row backwards or re-fire.
const DELIVERY_EVENT_STATE: Record<string, 'verified' | 'failed'> = {
  'email.delivered': 'verified',
  'email.bounced': 'failed',
  'email.complained': 'failed',
  'email.failed': 'failed',
};

export async function promoteLedgerByResendId(resendId: string, eventType: string): Promise<boolean> {
  const target = DELIVERY_EVENT_STATE[eventType];
  if (!target || !resendId) return false;
  // Only advance from a live pre-terminal state. 'delivered' promotes executed/approved
  // → verified; a bounce/complaint can also downgrade an already-'verified' row to failed
  // (honest: it didn't actually land), but never touches 'reported'/'refused'.
  const fromStates = target === 'verified' ? ['executed', 'approved'] : ['executed', 'approved', 'verified'];
  const patch: Record<string, unknown> =
    target === 'verified'
      ? { state: 'verified', verified_at: nowIso(), updated_at: nowIso() }
      : { state: 'failed', error: eventType.replace('email.', ''), updated_at: nowIso() };
  const { data, error } = await supabaseAdmin
    .from('janet_action_ledger')
    .update(patch)
    .eq('result->>id', resendId)
    .in('state', fromStates)
    .select('id');
  if (error) {
    console.error('[verify] ledger promote failed:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// ── Publish: confirm the public URL actually serves the page's content ─────
export type PublishVerification = { verified: boolean; status?: number; error?: string };

/**
 * Fetch the public URL and confirm the page's own content is served (the doc
 * title, which the template renders in <title> and <h1>). A missing/unpublished
 * slug rewrites to /404 — the title marker won't be present there, so it fails.
 */
export async function verifyPublishedUrl(url: string, titleMarker: string): Promise<PublishVerification> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'janet-readback/1.0' }, redirect: 'follow' });
    if (!res.ok) return { verified: false, status: res.status, error: `HTTP ${res.status}` };
    const html = await res.text();
    // Match the template's default HTML escaping of the interpolated title.
    const marker = titleMarker.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (marker && !html.includes(marker)) {
      return { verified: false, status: res.status, error: 'page content not found at URL (title marker missing)' };
    }
    return { verified: true, status: res.status };
  } catch (e: any) {
    return { verified: false, error: e?.message ?? 'fetch failed' };
  }
}

/**
 * A ledger row for a publish, mirroring the send ledger so "did it publish?" is a
 * DB query too. One row per doc+slug (upsert on a stable key); moved to 'verified'
 * only by the read-after-write above.
 */
export async function ledgerPublish(input: {
  approvalRef: string | null;
  docId: string;
  slug: string;
  url: string;
  verified: boolean;
  error?: string | null;
}): Promise<void> {
  const row = {
    action_type: 'publish',
    lane: 'chat',
    idempotency_key: `publish:${input.docId}:${input.slug}`,
    approval_ref: input.approvalRef,
    payload: { doc_id: input.docId, slug: input.slug, url: input.url },
    result: { url: input.url },
    state: input.verified ? 'verified' : 'executed',
    error: input.verified ? null : input.error ?? 'not verified',
    executed_at: nowIso(),
    verified_at: input.verified ? nowIso() : null,
    updated_at: nowIso(),
  };
  const { error } = await supabaseAdmin.from('janet_action_ledger').upsert(row, { onConflict: 'idempotency_key' });
  if (error) console.error('[verify] publish ledger upsert failed:', error.message);
}
