// Clear Ear Studios - invoicing core (Phase 2a). The single source of truth for
// building invoices (from sessions or manual lines), recording payments, and the
// derived money math (subtotal -> tax -> total -> amount_paid -> balance ->
// status). Tools and the admin API both call these - no duplicated math.
//
// Rule Zero: nothing invents an amount. A line's amount is a real session amount
// or an explicit unit_price x quantity. A payment amount is what Blue states.

import { supabaseAdmin } from '../../supabase';
import { randomBytes } from 'node:crypto';

const round2 = (n: number) => Math.round(n * 100) / 100;
const newViewToken = () => randomBytes(18).toString('base64url');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const today = () => new Date().toISOString().slice(0, 10);

export type InvoiceLineInput = {
  description?: string;
  service_label?: string | null;
  quantity?: number;
  unit_price?: number;
  amount?: number;
  session_id?: string | null;
};

export type CreateInvoiceInput = {
  contact_id: string;
  session_ids?: string[]; // seed lines from these unbilled sessions
  lines?: InvoiceLineInput[]; // and/or manual lines
  due_date?: string | null;
  tax_rate?: number | null;
  payment_methods?: string[];
  notes?: string | null;
};

/** Build a draft invoice. Seeds line items from the given sessions (marking them
 *  invoiced) and/or from manual lines, computes the totals, assigns the next
 *  sequential number. Returns the full invoice (with lines). */
export async function createInvoice(input: CreateInvoiceInput) {
  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name').eq('id', input.contact_id).maybeSingle();
  if (!contact) throw new Error(`No Clear Ear contact with id ${input.contact_id} - look them up or create them first.`);

  const lines: Required<InvoiceLineInput>[] = [];

  // Lines from sessions (must belong to this contact and be unbilled).
  const sessionIds = Array.isArray(input.session_ids) ? input.session_ids.filter(Boolean) : [];
  if (sessionIds.length) {
    const { data: sessions } = await supabaseAdmin
      .from('clearear_sessions')
      .select('id, contact_id, service_label, session_date, hours, rate, amount, invoice_id, notes')
      .in('id', sessionIds);
    for (const s of sessions ?? []) {
      if (s.contact_id !== input.contact_id) throw new Error(`Session ${s.id} belongs to a different contact.`);
      if (s.invoice_id) throw new Error(`Session ${s.id} is already on an invoice.`);
      const hrs = s.hours != null ? num(s.hours) : 1;
      const unit = s.rate != null ? num(s.rate) : num(s.amount);
      const desc = `${s.service_label ?? 'Studio session'}${s.hours != null ? ` - ${num(s.hours)} hrs` : ''}${s.rate != null ? ` @ ${usd(num(s.rate))}` : ''} (${s.session_date})`;
      lines.push({ description: desc, service_label: s.service_label ?? null, quantity: hrs, unit_price: round2(unit), amount: round2(num(s.amount)), session_id: s.id });
    }
  }

  // Manual lines.
  for (const l of input.lines ?? []) {
    const qty = l.quantity != null ? num(l.quantity) : 1;
    const unit = l.unit_price != null ? num(l.unit_price) : undefined;
    let amount = l.amount != null ? num(l.amount) : undefined;
    if (amount == null) {
      if (unit == null) throw new Error('A manual line needs either an amount, or a unit_price (times quantity). Nothing is guessed.');
      amount = round2(qty * unit);
    }
    lines.push({ description: (l.description ?? l.service_label ?? 'Line item').toString(), service_label: l.service_label ?? null, quantity: qty, unit_price: round2(unit ?? amount), amount: round2(amount), session_id: l.session_id ?? null });
  }

  if (lines.length === 0) throw new Error('An invoice needs at least one line - give session_ids or lines.');

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxRate = input.tax_rate != null ? num(input.tax_rate) : 0;
  const taxAmount = round2((subtotal * taxRate) / 100);
  const total = round2(subtotal + taxAmount);

  const { data: numberRow, error: numErr } = await supabaseAdmin.rpc('next_clearear_invoice_number');
  if (numErr) throw new Error(`Could not assign an invoice number: ${numErr.message}`);
  const invoice_number = numberRow as unknown as string;

  const { data: inv, error } = await supabaseAdmin
    .from('clearear_invoices')
    .insert({
      invoice_number,
      contact_id: input.contact_id,
      status: 'draft',
      issue_date: today(),
      due_date: input.due_date ?? null,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      amount_paid: 0,
      balance: total,
      payment_methods: Array.isArray(input.payment_methods) ? input.payment_methods : [],
      notes: input.notes ?? null,
      view_token: newViewToken(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const lineRows = lines.map((l, i) => ({ invoice_id: inv.id, session_id: l.session_id, description: l.description, service_label: l.service_label, quantity: l.quantity, unit_price: l.unit_price, amount: l.amount, sort_order: i }));
  const { error: lineErr } = await supabaseAdmin.from('clearear_invoice_lines').insert(lineRows);
  if (lineErr) throw new Error(lineErr.message);

  // Mark the sessions invoiced.
  const linkedSessions = lines.map((l) => l.session_id).filter(Boolean) as string[];
  if (linkedSessions.length) await supabaseAdmin.from('clearear_sessions').update({ invoice_id: inv.id }).in('id', linkedSessions);

  return getInvoice(inv.id);
}

/** Recompute an invoice's money + status from its lines and payments. Idempotent.
 *  paid when balance<=0, partial when 0<paid<total, else the non-payment status
 *  stays (draft/sent/viewed). Overdue-flipping is Phase 3. Never touches 'void'. */
export async function recomputeInvoice(invoiceId: string) {
  const { data: inv } = await supabaseAdmin.from('clearear_invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'void') return inv;

  const { data: lines } = await supabaseAdmin.from('clearear_invoice_lines').select('amount').eq('invoice_id', invoiceId);
  const subtotal = round2((lines ?? []).reduce((s, l) => s + num(l.amount), 0));
  const taxAmount = round2((subtotal * num(inv.tax_rate)) / 100);
  const total = round2(subtotal + taxAmount);

  const { data: payments } = await supabaseAdmin.from('clearear_payments').select('amount').eq('invoice_id', invoiceId);
  const amountPaid = round2((payments ?? []).reduce((s, p) => s + num(p.amount), 0));
  const balance = round2(total - amountPaid);

  let status = inv.status as string;
  let paidAt = inv.paid_at as string | null;
  if (total > 0 && balance <= 0) {
    status = 'paid';
    paidAt = paidAt ?? new Date().toISOString();
  } else if (amountPaid > 0 && balance > 0) {
    status = 'partial';
    paidAt = null;
  } else if (['partial', 'paid'].includes(status)) {
    // payments removed -> fall back to a non-payment status
    status = inv.sent_at ? 'sent' : 'draft';
    paidAt = null;
  }

  const { data: updated, error } = await supabaseAdmin
    .from('clearear_invoices')
    .update({ subtotal, tax_amount: taxAmount, total, amount_paid: amountPaid, balance, status, paid_at: paidAt, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return updated;
}

export type RecordPaymentInput = {
  invoice_id?: string | null;
  contact_id?: string;
  session_id?: string | null;
  amount: number;
  method: string;
  paid_at?: string;
  reference?: string | null;
  is_deposit?: boolean;
  notes?: string | null;
  recorded_by?: string;
};

/** Record a payment. If tied to an invoice, recomputes its balance + status. A
 *  payment can stand alone (cash for a session, no invoice). */
export async function recordPayment(input: RecordPaymentInput) {
  if (!(num(input.amount) > 0)) throw new Error('A payment needs a positive amount.');
  if (!input.method) throw new Error('A payment needs a method (cashapp/zelle/cash/check/ach/stripe/other).');

  let contactId = input.contact_id ?? null;
  if (input.invoice_id) {
    const { data: inv } = await supabaseAdmin.from('clearear_invoices').select('id, contact_id').eq('id', input.invoice_id).maybeSingle();
    if (!inv) throw new Error(`No invoice with id ${input.invoice_id}.`);
    contactId = contactId ?? inv.contact_id;
  }
  if (!contactId) throw new Error('A payment needs a contact_id (or an invoice_id to derive it).');

  const { data: payment, error } = await supabaseAdmin
    .from('clearear_payments')
    .insert({
      invoice_id: input.invoice_id ?? null,
      contact_id: contactId,
      session_id: input.session_id ?? null,
      amount: round2(num(input.amount)),
      method: input.method,
      paid_at: input.paid_at ?? today(),
      reference: input.reference ?? null,
      is_deposit: input.is_deposit ?? false,
      notes: input.notes ?? null,
      recorded_by: input.recorded_by ?? 'blue',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const invoice = input.invoice_id ? await recomputeInvoice(input.invoice_id) : null;
  return { payment, invoice };
}

/** Full invoice: header + lines + payments + contact. */
export async function getInvoice(id: string) {
  const { data: invoice } = await supabaseAdmin.from('clearear_invoices').select('*').eq('id', id).maybeSingle();
  if (!invoice) return null;
  const [{ data: lines }, { data: payments }, { data: contact }] = await Promise.all([
    supabaseAdmin.from('clearear_invoice_lines').select('*').eq('invoice_id', id).order('sort_order'),
    supabaseAdmin.from('clearear_payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: false }),
    supabaseAdmin.from('clearear_contacts').select('*').eq('id', invoice.contact_id).maybeSingle(),
  ]);
  return { invoice, lines: lines ?? [], payments: payments ?? [], contact: contact ?? null };
}

export async function listInvoices(opts: { status?: string; contact_id?: string; limit?: number } = {}) {
  let q = supabaseAdmin
    .from('clearear_invoices')
    .select('id, invoice_number, contact_id, status, issue_date, due_date, total, amount_paid, balance, clearear_contacts(name)')
    .order('issue_date', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 300));
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.contact_id) q = q.eq('contact_id', opts.contact_id);
  const { data } = await q;
  return (data ?? []).map((r: any) => ({ ...r, contact_name: r.clearear_contacts?.name ?? null, clearear_contacts: undefined }));
}

/** Who owes what: open invoices with a balance, newest first, plus days overdue. */
export async function getOutstanding() {
  const { data } = await supabaseAdmin
    .from('clearear_invoices')
    .select('id, invoice_number, contact_id, status, issue_date, due_date, total, amount_paid, balance, clearear_contacts(name)')
    .gt('balance', 0)
    .not('status', 'in', '(void,paid)')
    .order('due_date', { ascending: true });
  const now = Date.now();
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    invoice_number: r.invoice_number,
    contact: r.clearear_contacts?.name ?? null,
    status: r.status,
    due_date: r.due_date,
    balance: num(r.balance),
    days_overdue: r.due_date ? Math.max(0, Math.floor((now - new Date(r.due_date).getTime()) / 86_400_000)) : 0,
  }));
  const total = round2(rows.reduce((s, r) => s + r.balance, 0));
  return { total_outstanding: total, count: rows.length, invoices: rows };
}

export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Assemble everything the invoice document needs: invoice + lines + payments +
 *  contact + issuer settings + the SELECTED payment methods (in order, with their
 *  instructions). Used by both the PDF route and the client web view. */
export async function assembleInvoiceForDocument(id: string) {
  const data = await getInvoice(id);
  if (!data) return null;
  const { data: settings } = await supabaseAdmin.from('clearear_settings').select('*').eq('id', 1).maybeSingle();
  const keys: string[] = (data.invoice as any).payment_methods ?? [];
  let methods: { label: string; instructions: string | null }[] = [];
  if (keys.length) {
    const { data: pm } = await supabaseAdmin.from('clearear_payment_methods').select('key, label, instructions').in('key', keys);
    methods = keys.map((k) => (pm ?? []).find((m: any) => m.key === k)).filter(Boolean).map((m: any) => ({ label: m.label, instructions: m.instructions }));
  }
  return { ...data, settings: settings ?? {}, methods };
}

/** Resolve an invoice id from its public view token. */
export async function invoiceIdForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const { data } = await supabaseAdmin.from('clearear_invoices').select('id').eq('view_token', token).maybeSingle();
  return (data as any)?.id ?? null;
}

/** Ensure an invoice has a view token (older rows / on-demand), return it. */
export async function ensureViewToken(id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('clearear_invoices').select('view_token').eq('id', id).maybeSingle();
  if (!data) return null;
  if ((data as any).view_token) return (data as any).view_token;
  const token = newViewToken();
  await supabaseAdmin.from('clearear_invoices').update({ view_token: token }).eq('id', id);
  return token;
}

/** Client opened the invoice link: stamp viewed_at and promote sent -> viewed
 *  (only then - a draft preview by Blue or an already-paid invoice is untouched). */
export async function markInvoiceViewed(id: string): Promise<void> {
  const { data: inv } = await supabaseAdmin.from('clearear_invoices').select('status, viewed_at').eq('id', id).maybeSingle();
  if (!inv) return;
  if ((inv as any).status !== 'sent') return;
  await supabaseAdmin.from('clearear_invoices').update({ status: 'viewed', viewed_at: (inv as any).viewed_at ?? new Date().toISOString() }).eq('id', id);
}
