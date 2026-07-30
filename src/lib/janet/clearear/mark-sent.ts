// Clear Ear Studios — "I sent this one myself" (external send provenance).
//
// When Blue sends an invoice out of band (his Gmail, a text, in person), the
// invoice must reflect 'sent' WITHOUT the system claiming it sent it. This is the
// record_external_action pattern specialized to an invoice:
//   • writes a janet_external_actions row (system_verified=false by CHECK),
//     linked to the invoice by invoice_id — so a REPORTED-sent invoice is never
//     indistinguishable from a SYSTEM-sent one in any downstream query;
//   • flips the invoice draft -> sent;
//   • is idempotent on the invoice (a repeat is a no-op returning the same row);
//   • reverses by RETRACTING the external-action row (annotate, never overwrite)
//     and reverting the invoice to draft — and only if it has not been paid.
//
// Both the admin API action and JANET's tool route through here, so the two
// surfaces cannot drift.

import { supabaseAdmin } from '../../supabase';
import { guardedCreate, naturalKey } from '../write-executor';

export const MARK_SENT_CHANNELS = ['email', 'text', 'in_person', 'personal_email'] as const;
export type MarkSentChannel = (typeof MARK_SENT_CHANNELS)[number];

type Invoice = { id: string; invoice_number: string; status: string; amount_paid: number | string | null };

async function loadInvoice(invoiceId: string): Promise<Invoice> {
  const { data } = await supabaseAdmin
    .from('clearear_invoices')
    .select('id, invoice_number, status, amount_paid')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!data) throw new Error('Invoice not found.');
  return data as Invoice;
}

/** The single active (non-retracted) external-action row that marked this invoice sent, if any. */
async function activeMarkRow(invoiceId: string) {
  const { data } = await supabaseAdmin
    .from('janet_external_actions')
    .select('*')
    .eq('invoice_id', invoiceId)
    .is('retracted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export type MarkSentResult = {
  marked: boolean;
  dedup: boolean;
  status: string;
  invoice_number: string;
  external_action: any;
};

/**
 * Record that `invoiceId` was sent out of band, and flip it draft -> sent.
 * Draft-only: refuses a sent/viewed/overdue/paid/void invoice (a mark_sent on an
 * already-out invoice is the wrong action). Idempotent: a second call on an
 * invoice already marked-sent-externally returns the existing row, no second row.
 */
export async function markInvoiceSentExternally(args: {
  invoiceId: string;
  channel: string;
  note?: string | null;
  actor?: string;
}): Promise<MarkSentResult> {
  const actor = (args.actor || 'blue').trim();
  const channel = String(args.channel || '').trim();
  if (!(MARK_SENT_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`channel must be one of: ${MARK_SENT_CHANNELS.join(', ')}`);
  }
  const note = args.note?.trim() || null;

  const inv = await loadInvoice(args.invoiceId);

  // Idempotent replay: already marked sent externally and not retracted -> no-op,
  // return the existing row. (Requirement: same principle as janet_conversions on APPTID.)
  const existing = await activeMarkRow(inv.id);
  if (existing) {
    return { marked: true, dedup: true, status: inv.status, invoice_number: inv.invoice_number, external_action: existing };
  }

  // Fresh mark is draft-only. Anything already out (sent/viewed/overdue), paid,
  // partial, or void is the wrong target — never make a sent invoice look reported.
  if (inv.status !== 'draft') {
    throw new Error(
      `${inv.invoice_number} is '${inv.status}', not draft — mark_sent only applies to a draft you sent yourself. ` +
        `A ${inv.status} invoice is already out (or paid/void); use void to reverse it if that is what you mean.`,
    );
  }

  const occurredAt = new Date().toISOString();
  const description = `Invoice ${inv.invoice_number} reported sent by ${actor} via ${channel}`;

  // Generation guards a re-mark after a prior reversal: the retracted row keeps its
  // key, so a new attempt after reversal must key differently to create a fresh row
  // rather than dedup back to the retracted one. Concurrent FIRST marks share the
  // same generation (count=0) and are still de-duped by the ledger's unique key.
  const { count } = await supabaseAdmin
    .from('janet_external_actions')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', inv.id);
  const key = naturalKey('clearear_invoice_marked_sent', [inv.id, count ?? 0]);

  const { row, dedup } = await guardedCreate<any>({
    actionType: 'clearear_invoice_marked_sent',
    idempotencyKey: key,
    actor,
    payload: { invoice_id: inv.id, channel, note },
    create: async () => {
      const { data, error } = await supabaseAdmin
        .from('janet_external_actions')
        .insert({ actor, channel, description, note, occurred_at: occurredAt, invoice_id: inv.id, idempotency_key: key })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    reread: async (id) => (await supabaseAdmin.from('janet_external_actions').select('*').eq('id', id).maybeSingle()).data,
  });

  // Flip status only after the provenance row is on record. Guard the WHERE on
  // status='draft' so a race can't double-apply.
  await supabaseAdmin
    .from('clearear_invoices')
    .update({ status: 'sent', sent_at: occurredAt, updated_at: new Date().toISOString() })
    .eq('id', inv.id)
    .eq('status', 'draft');

  return { marked: true, dedup, status: 'sent', invoice_number: inv.invoice_number, external_action: row };
}

export type ReverseMarkSentResult = {
  reversed: boolean;
  status: string;
  invoice_number: string;
  retracted_external_action_id: string;
};

/**
 * Reverse an external mark_sent: revert the invoice sent -> draft AND retract the
 * linked external-action row (retract-don't-overwrite — the row is kept and
 * annotated, never left silently claiming 'sent'). Refuses if the invoice has any
 * payment (paid/partial or amount_paid > 0) — never revert after money moved — or
 * if it was never marked sent externally (a system-sent invoice is voided, not
 * reverted this way).
 */
export async function reverseInvoiceMarkSent(args: {
  invoiceId: string;
  reason: string;
  actor?: string;
}): Promise<ReverseMarkSentResult> {
  const actor = (args.actor || 'blue').trim();
  const reason = String(args.reason || '').trim();
  if (!reason) throw new Error('A reason is required to reverse a mark-sent (it stays on the record).');

  const inv = await loadInvoice(args.invoiceId);

  if (inv.status === 'void') throw new Error(`${inv.invoice_number} is void.`);
  if (inv.status === 'paid' || inv.status === 'partial' || Number(inv.amount_paid) > 0) {
    throw new Error(`${inv.invoice_number} has payments — reversal is blocked. Void it instead so the record survives.`);
  }

  const row = await activeMarkRow(inv.id);
  if (!row) {
    throw new Error(
      `${inv.invoice_number} was not marked sent externally — nothing to reverse. ` +
        `If it was sent by the system, void it instead.`,
    );
  }

  // Retract the external-action row: keep it, annotate. Guard on retracted_at IS
  // NULL so a concurrent reversal can't double-retract.
  const retractedAt = new Date().toISOString();
  await supabaseAdmin
    .from('janet_external_actions')
    .update({ retracted_at: retractedAt, retracted_reason: `${reason} (reversed by ${actor})` })
    .eq('id', row.id)
    .is('retracted_at', null);

  // Revert the invoice.
  await supabaseAdmin
    .from('clearear_invoices')
    .update({ status: 'draft', sent_at: null, updated_at: new Date().toISOString() })
    .eq('id', inv.id);

  return { reversed: true, status: 'draft', invoice_number: inv.invoice_number, retracted_external_action_id: row.id };
}
