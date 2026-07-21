// Clear Ear Studios - reversibility (Bug 1). Every financial write has a defined
// reversal. The taxonomy, and which one each write gets:
//
//   void                 -> invoices that left the building (sent/paid/overdue).
//                           Preserves the row, the number, and the payment history.
//   hard_delete_guarded  -> an erroneous DRAFT that was never sent and has no
//                           payments; sessions, payments (recompute after).
//
// Voiding an invoice: status='void', its payments are SOFT-voided (never deleted -
// the audit trail must survive), balances zeroed, and its sessions RELEASED back to
// unbilled so the work can be re-invoiced correctly.

import { supabaseAdmin } from '../../supabase';
import { logJanetAction } from '../actions';
import { recomputeInvoice } from './invoicing';

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

/** Void an invoice. Reversible-by-design: nothing is destroyed. */
export async function voidInvoice(invoiceId: string, reason: string, actor = 'janet') {
  const { data: inv } = await supabaseAdmin
    .from('clearear_invoices')
    .select('id, invoice_number, status, total, amount_paid')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) throw new Error(`No Clear Ear invoice with id ${invoiceId}.`);
  if (inv.status === 'void') return { voided: true, already: true, invoice_number: inv.invoice_number };
  if (!reason || !reason.trim()) throw new Error('Voiding an invoice requires a reason (it stays on the record).');

  const now = new Date().toISOString();

  // Soft-void the payments (kept for the trail; excluded from collected revenue).
  const { data: voidedPays } = await supabaseAdmin
    .from('clearear_payments')
    .update({ voided_at: now, void_reason: `invoice ${inv.invoice_number} voided: ${reason.trim()}` })
    .eq('invoice_id', invoiceId)
    .is('voided_at', null)
    .select('id, amount');

  // Release the sessions back to unbilled so the work can be re-invoiced.
  const { data: freed } = await supabaseAdmin
    .from('clearear_sessions')
    .update({ invoice_id: null })
    .eq('invoice_id', invoiceId)
    .select('id');

  const { data: updated, error } = await supabaseAdmin
    .from('clearear_invoices')
    .update({ status: 'void', voided_at: now, void_reason: reason.trim(), amount_paid: 0, balance: 0, updated_at: now })
    .eq('id', invoiceId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await logJanetAction({
    tool_name: 'void_clearear_invoice',
    ring: 2,
    input: { invoice_id: invoiceId, reason: reason.trim(), actor },
    status: 'completed',
    output_summary: `Voided ${inv.invoice_number}: ${reason.trim()}. Reversed ${voidedPays?.length ?? 0} payment(s) totalling $${(voidedPays ?? []).reduce((s, p) => s + num(p.amount), 0)}; released ${freed?.length ?? 0} session(s) back to unbilled.`,
  });

  return {
    voided: true,
    invoice_number: inv.invoice_number,
    payments_reversed: voidedPays?.length ?? 0,
    payments_reversed_amount: (voidedPays ?? []).reduce((s, p) => s + num(p.amount), 0),
    sessions_released: freed?.length ?? 0,
    invoice: updated,
  };
}

/** Hard-delete an erroneous DRAFT invoice that never left the building.
 *  Refuses anything sent, viewed, paid, or carrying payments — void those. */
export async function deleteDraftInvoice(invoiceId: string, actor = 'janet') {
  const { data: inv } = await supabaseAdmin
    .from('clearear_invoices')
    .select('id, invoice_number, status, sent_at')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) throw new Error(`No Clear Ear invoice with id ${invoiceId}.`);
  if (inv.status !== 'draft' || inv.sent_at) {
    throw new Error(`${inv.invoice_number} is "${inv.status}"${inv.sent_at ? ' and has been sent' : ''} — VOID it instead of deleting, so the number and trail survive.`);
  }
  const { count } = await supabaseAdmin.from('clearear_payments').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId);
  if ((count ?? 0) > 0) throw new Error(`${inv.invoice_number} has ${count} payment(s) — void it instead of deleting.`);

  const { data: freed } = await supabaseAdmin.from('clearear_sessions').update({ invoice_id: null }).eq('invoice_id', invoiceId).select('id');
  await supabaseAdmin.from('clearear_invoice_lines').delete().eq('invoice_id', invoiceId);
  const { error } = await supabaseAdmin.from('clearear_invoices').delete().eq('id', invoiceId);
  if (error) throw new Error(error.message);

  await logJanetAction({
    tool_name: 'delete_clearear_draft_invoice', ring: 2, input: { invoice_id: invoiceId, actor }, status: 'completed',
    output_summary: `Deleted erroneous draft ${inv.invoice_number} (never sent); released ${freed?.length ?? 0} session(s).`,
  });
  return { deleted: true, invoice_number: inv.invoice_number, sessions_released: freed?.length ?? 0 };
}

/** Delete a session created in error. Refuses once it's on an invoice. */
export async function deleteSessionRecord(sessionId: string, actor = 'janet') {
  const { data: s } = await supabaseAdmin.from('clearear_sessions').select('id, invoice_id, amount, session_date, service_label').eq('id', sessionId).maybeSingle();
  if (!s) throw new Error(`No Clear Ear session with id ${sessionId}.`);
  if (s.invoice_id) throw new Error('That session is on an invoice — void or edit the invoice first; a billed session cannot be deleted underneath it.');
  const { error } = await supabaseAdmin.from('clearear_sessions').delete().eq('id', sessionId);
  if (error) throw new Error(error.message);
  await logJanetAction({
    tool_name: 'delete_clearear_session', ring: 2, input: { session_id: sessionId, actor }, status: 'completed',
    output_summary: `Deleted session ${s.session_date} ${s.service_label ?? ''} ($${num(s.amount)}) created in error.`,
  });
  return { deleted: true, session_date: s.session_date, amount: num(s.amount) };
}

/** Delete a payment recorded in error, then recompute its invoice. */
export async function deletePaymentRecord(paymentId: string, actor = 'janet') {
  const { data: p } = await supabaseAdmin.from('clearear_payments').select('id, invoice_id, amount, method, paid_at').eq('id', paymentId).maybeSingle();
  if (!p) throw new Error(`No Clear Ear payment with id ${paymentId}.`);
  const { error } = await supabaseAdmin.from('clearear_payments').delete().eq('id', paymentId);
  if (error) throw new Error(error.message);
  let invoice = null;
  if (p.invoice_id) invoice = await recomputeInvoice(p.invoice_id); // balance/status fall back correctly
  await logJanetAction({
    tool_name: 'delete_clearear_payment', ring: 2, input: { payment_id: paymentId, actor }, status: 'completed',
    output_summary: `Deleted payment $${num(p.amount)} ${p.method} (${p.paid_at}) recorded in error; invoice recomputed.`,
  });
  return { deleted: true, amount: num(p.amount), method: p.method, invoice };
}
