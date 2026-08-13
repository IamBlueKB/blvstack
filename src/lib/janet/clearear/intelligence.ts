// Clear Ear Studios - studio intelligence (Phase 3.3/3.4). Every number comes from
// real rows: payments (money actually collected), invoices/lines (what was billed),
// sessions, contacts. Billed and collected are kept DISTINCT and labeled - a
// service's "billed" is not the same as "collected", and we never blur them or
// estimate. Unknowns are stated, not guessed.

import { supabaseAdmin } from '../../supabase';
import { assertBusiness, type Business } from './expenses';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const monthKey = (d: string) => (d || '').slice(0, 7);

export type StudioIntelligence = {
  as_of: string;
  window: string;
  collected: { total: number; by_month: Record<string, number>; by_method: Record<string, number> };
  billed_by_service: { service: string; billed: number; lines: number }[]; // BILLED, not collected
  receivables: { outstanding_total: number; count: number; aging: { current: number; d1_30: number; d31_60: number; d60_plus: number } };
  top_clients: { contact: string; collected: number; billed: number; sessions: number; last_session: string | null }[];
  lapsed_clients: { contact: string; last_session: string | null; days: number }[];
  note: string;
};

/**
 * Compute studio intelligence. `year` scopes billed/collected to that calendar
 * year (e.g. "the youth program this year"); omit for all-time. Lapsed threshold
 * is `lapsedDays` (default 60). Grounded entirely in stored rows.
 */
export async function getStudioIntelligence(opts: { business: Business | 'all'; year?: number; lapsedDays?: number }): Promise<StudioIntelligence> {
  const lapsedDays = opts.lapsedDays ?? 60;
  const yearPrefix = opts.year ? String(opts.year) : null;
  const today = new Date().toISOString().slice(0, 10);
  // Every money table is scoped to ONE business. 'all' is the deliberate entity-wide
  // (combined) view; there is no unscoped default.
  const B = opts.business;
  const scope = <T extends { eq: (c: string, v: string) => T }>(q: T): T => (B === 'all' ? q : q.eq('business', assertBusiness(B)));

  const [paysRes, invRes, linesRes, sessRes, contactsRes] = await Promise.all([
    // voided payments are excluded from collected revenue (they belong to a voided invoice)
    scope(supabaseAdmin.from('clearear_payments').select('amount, method, paid_at, contact_id').is('voided_at', null) as any),
    scope(supabaseAdmin.from('clearear_invoices').select('id, contact_id, status, issue_date, due_date, total, balance').neq('status', 'void') as any),
    scope(supabaseAdmin.from('clearear_invoice_lines').select('amount, service_label, invoice_id') as any),
    scope(supabaseAdmin.from('clearear_sessions').select('contact_id, session_date') as any),
    supabaseAdmin.from('clearear_contacts').select('id, name, status'), // contacts are shared (a person, not a transaction)
  ]);
  const payments = (paysRes.data ?? []) as any[];
  const invoices = (invRes.data ?? []) as any[];
  const lines = (linesRes.data ?? []) as any[];
  const sessions = (sessRes.data ?? []) as any[];
  const contacts = (contactsRes.data ?? []) as any[];
  const nameOf = new Map(contacts.map((c) => [c.id, c.name]));
  const inYear = (d: string) => (yearPrefix ? String(d || '').startsWith(yearPrefix) : true);

  // ── Collected (real money in) ──
  const byMonth: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  const collectedByContact = new Map<string, number>();
  let collectedTotal = 0;
  for (const p of payments) {
    if (!inYear(p.paid_at)) continue;
    const a = num(p.amount);
    collectedTotal += a;
    byMonth[monthKey(p.paid_at)] = round2((byMonth[monthKey(p.paid_at)] ?? 0) + a);
    byMethod[p.method ?? 'other'] = round2((byMethod[p.method ?? 'other'] ?? 0) + a);
    if (p.contact_id) collectedByContact.set(p.contact_id, round2((collectedByContact.get(p.contact_id) ?? 0) + a));
  }

  // ── Billed by service (from invoice lines; scoped by the invoice's issue year) ──
  const invYear = new Map(invoices.map((i) => [i.id, i.issue_date]));
  const svc = new Map<string, { billed: number; lines: number }>();
  const billedByContact = new Map<string, number>();
  const invContact = new Map(invoices.map((i) => [i.id, i.contact_id]));
  for (const l of lines) {
    const iss = invYear.get(l.invoice_id);
    if (iss === undefined || !inYear(iss)) continue;
    const key = l.service_label || 'Unlabeled';
    const cur = svc.get(key) ?? { billed: 0, lines: 0 };
    cur.billed = round2(cur.billed + num(l.amount));
    cur.lines += 1;
    svc.set(key, cur);
    const cid = invContact.get(l.invoice_id);
    if (cid) billedByContact.set(cid, round2((billedByContact.get(cid) ?? 0) + num(l.amount)));
  }
  const billed_by_service = [...svc.entries()].map(([service, v]) => ({ service, billed: v.billed, lines: v.lines })).sort((a, b) => b.billed - a.billed);

  // ── Receivables aging (open balances; all-time, not year-scoped) ──
  const aging = { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 };
  let outstandingTotal = 0, outstandingCount = 0;
  for (const i of invoices) {
    const bal = num(i.balance);
    if (bal <= 0 || i.status === 'paid') continue;
    outstandingTotal = round2(outstandingTotal + bal);
    outstandingCount++;
    const od = i.due_date ? Math.floor((Date.now() - new Date(i.due_date).getTime()) / 86_400_000) : 0;
    if (od <= 0) aging.current = round2(aging.current + bal);
    else if (od <= 30) aging.d1_30 = round2(aging.d1_30 + bal);
    else if (od <= 60) aging.d31_60 = round2(aging.d31_60 + bal);
    else aging.d60_plus = round2(aging.d60_plus + bal);
  }

  // ── Per-contact sessions + last session ──
  const sessCount = new Map<string, number>();
  const lastSession = new Map<string, string>();
  for (const s of sessions) {
    sessCount.set(s.contact_id, (sessCount.get(s.contact_id) ?? 0) + 1);
    const prev = lastSession.get(s.contact_id);
    if (!prev || s.session_date > prev) lastSession.set(s.contact_id, s.session_date);
  }

  const top_clients = [...new Set([...collectedByContact.keys(), ...billedByContact.keys()])]
    .map((cid) => ({ contact: nameOf.get(cid) ?? 'Unknown', collected: collectedByContact.get(cid) ?? 0, billed: billedByContact.get(cid) ?? 0, sessions: sessCount.get(cid) ?? 0, last_session: lastSession.get(cid) ?? null }))
    .sort((a, b) => b.collected - a.collected || b.billed - a.billed)
    .slice(0, 12);

  const lapsed_clients = contacts
    .filter((c) => c.status === 'active')
    .map((c) => ({ contact: c.name, last: lastSession.get(c.id) ?? null }))
    .filter((c) => c.last && Math.floor((Date.now() - new Date(c.last!).getTime()) / 86_400_000) >= lapsedDays)
    .map((c) => ({ contact: c.contact, last_session: c.last, days: Math.floor((Date.now() - new Date(c.last!).getTime()) / 86_400_000) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 15);

  return {
    as_of: today,
    window: yearPrefix ? `calendar year ${yearPrefix}` : 'all time',
    collected: { total: round2(collectedTotal), by_month: byMonth, by_method: byMethod },
    billed_by_service,
    receivables: { outstanding_total: outstandingTotal, count: outstandingCount, aging },
    top_clients,
    lapsed_clients,
    note: 'collected = payments actually recorded; billed_by_service = invoice line amounts (billed, not necessarily collected). Payments are not line-itemized, so per-service COLLECTED cannot be derived - only billed. Receivables/aging are all-time open balances.',
  };
}

/** A compact, honest one-liner for JANET's snapshot so she's aware of the studio
 *  state without pulling the full report every turn. Null when there's nothing yet. */
export async function getClearearSnapshotLine(): Promise<string | null> {
  const [{ count: contactCount }, { data: openInv }] = await Promise.all([
    supabaseAdmin.from('clearear_contacts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    // Snapshot line is the STUDIO line in JANET's prompt — scoped to Clear Ear.
    supabaseAdmin.from('clearear_invoices').select('balance, due_date, status').eq('business', 'clearear').gt('balance', 0).not('status', 'in', '(void,paid)'),
  ]);
  if (!contactCount && (!openInv || openInv.length === 0)) return null;
  const outstanding = round2((openInv ?? []).reduce((s, i) => s + num(i.balance), 0));
  const overdue = (openInv ?? []).filter((i) => i.due_date && new Date(i.due_date).getTime() < Date.now());
  const overdueTotal = round2(overdue.reduce((s, i) => s + num(i.balance), 0));
  const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const parts = [`${contactCount ?? 0} active contacts`];
  if (outstanding > 0) parts.push(`${usd(outstanding)} outstanding across ${(openInv ?? []).length} invoice(s)`);
  if (overdue.length) parts.push(`${overdue.length} OVERDUE (${usd(overdueTotal)})`);
  return `Clear Ear Studios: ${parts.join(' · ')}. Full numbers via get_clearear_intelligence.`;
}

// ── Books (Phase 2): P&L. Cash basis. Two net numbers (addendum A2): net_cash is
// money in minus ALL expenses (owner draws excluded); net_taxable is collected minus
// only the DEDUCTIBLE portion of expenses plus the mileage deduction (A4 — mileage
// flows into net_taxable only, never net_cash: no cash left the account).
export type Books = {
  business: Business | 'all';
  window: string;
  collected: number;
  expenses_total: number;                 // all expenses, owner draws excluded
  deductible_expenses: number;            // sum(amount * deductible_pct/100) over deductible rows
  mileage_deduction: number;
  net_cash: number;                       // collected - expenses_total
  net_taxable: number;                    // collected - deductible_expenses - mileage_deduction
  expenses_by_category: { category: string; label: string; amount: number }[];
  by_month: Record<string, { collected: number; expenses: number; net_cash: number }>;
  basis: string;
};

export async function getBooks(opts: { business: Business | 'all'; year?: number }): Promise<Books> {
  const y = opts.year;
  const lo = y ? `${y}-01-01` : '0001-01-01';
  const hi = y ? `${y}-12-31` : '9999-12-31';
  // business: one arm's books, or 'all' for the COMBINED entity P&L (the filing
  // number — same legal entity, one return). Combined is exactly the sum of both
  // because every row belongs to exactly one business.
  const B = opts.business;
  const scope = <T extends { eq: (c: string, v: string) => T }>(q: T): T => (B === 'all' ? q : q.eq('business', assertBusiness(B)));

  const [{ data: pays }, { data: exps }, { data: miles }, { data: cats }] = await Promise.all([
    scope(supabaseAdmin.from('clearear_payments').select('amount, paid_at, voided_at').gte('paid_at', lo).lte('paid_at', hi) as any),
    scope(supabaseAdmin.from('clearear_expenses').select('amount, spent_at, category_key, deductible, deductible_pct, is_owner_draw').gte('spent_at', lo).lte('spent_at', hi) as any),
    scope(supabaseAdmin.from('clearear_mileage').select('miles, rate_cents, drove_on').gte('drove_on', lo).lte('drove_on', hi) as any),
    supabaseAdmin.from('clearear_expense_categories').select('key, label'), // shared taxonomy
  ]);

  const labelOf = new Map((cats ?? []).map((c: any) => [c.key, c.label]));
  const byMonth: Record<string, { collected: number; expenses: number; net_cash: number }> = {};
  const bump = (m: string) => (byMonth[m] ??= { collected: 0, expenses: 0, net_cash: 0 });

  let collected = 0;
  for (const p of pays ?? []) {
    if (p.voided_at) continue;
    const a = num(p.amount);
    collected += a;
    bump(monthKey(p.paid_at)).collected += a;
  }

  let expensesTotal = 0, deductible = 0;
  const catAgg = new Map<string, number>();
  for (const e of exps ?? []) {
    if (e.is_owner_draw) continue;
    const a = num(e.amount);
    expensesTotal += a;
    bump(monthKey(e.spent_at)).expenses += a;
    catAgg.set(e.category_key, round2((catAgg.get(e.category_key) ?? 0) + a));
    if (e.deductible) deductible += a * (num(e.deductible_pct) / 100);
  }

  const mileageDeduction = round2((miles ?? []).reduce((s: number, m: any) => s + num(m.miles) * num(m.rate_cents) / 100, 0));

  for (const k of Object.keys(byMonth)) byMonth[k].net_cash = round2(byMonth[k].collected - byMonth[k].expenses);

  const expenses_by_category = [...catAgg.entries()]
    .map(([category, amount]) => ({ category, label: (labelOf.get(category) as string) ?? category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    business: B,
    window: y ? String(y) : 'All time',
    collected: round2(collected),
    expenses_total: round2(expensesTotal),
    deductible_expenses: round2(deductible),
    mileage_deduction: mileageDeduction,
    net_cash: round2(collected - expensesTotal),
    net_taxable: round2(collected - deductible - mileageDeduction),
    expenses_by_category,
    by_month: byMonth,
    basis: 'Cash basis — income when collected, expenses when paid. net_taxable applies each expense’s deductible % and adds the mileage deduction; confirm specifics with your tax preparer.',
  };
}

// ── 1099-NEC (Phase 3, addendum A7). You issue 1099-NEC only for amounts NOT
// already reported by a processor on 1099-K. So EXCLUDE card / stripe / cashapp
// (third-party networks that file 1099-K) — keep cash/check/ach/zelle/other. And
// EXCLUDE corporations (generally exempt). Threshold: $600/contractor/year. Rows
// that clear the threshold but are excluded are surfaced SEPARATELY so nothing
// silently vanishes, and missing-W-9 is flagged.
const NINETEEN_K_METHODS = new Set(['card', 'stripe', 'cashapp']); // processor files 1099-K
export type Contractor1099 = {
  year: number;
  required: { contact: string; contact_id: string; total: number; tax_id_on_file: boolean; address: any }[];
  excluded: { contact: string; total: number; reason: string }[];
  missing_w9: string[];
};

// 1099 is filed by the ENTITY, so it defaults to 'all' (both businesses combined) —
// a contractor paid $400 by each arm still crosses $600 for the one return.
export async function get1099(year: number, business: Business | 'all' = 'all'): Promise<Contractor1099> {
  let q = supabaseAdmin
    .from('clearear_expenses')
    .select('amount, method, contractor_contact_id, is_owner_draw')
    .not('contractor_contact_id', 'is', null)
    .gte('spent_at', `${year}-01-01`).lte('spent_at', `${year}-12-31`);
  if (business !== 'all') q = q.eq('business', assertBusiness(business));
  const { data: rows } = await q;

  // Per contractor: total in reportable (non-1099-K) methods, and total overall.
  const nec = new Map<string, number>();
  const gross = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r.is_owner_draw) continue;
    const id = r.contractor_contact_id as string;
    const a = num(r.amount);
    gross.set(id, round2((gross.get(id) ?? 0) + a));
    if (!NINETEEN_K_METHODS.has(r.method)) nec.set(id, round2((nec.get(id) ?? 0) + a));
  }

  const ids = [...new Set([...gross.keys()])];
  const contacts = ids.length
    ? (await supabaseAdmin.from('clearear_contacts').select('id, name, tax_id_on_file, is_corporation, address').in('id', ids)).data ?? []
    : [];
  const byId = new Map(contacts.map((c: any) => [c.id, c]));

  const required: Contractor1099['required'] = [];
  const excluded: Contractor1099['excluded'] = [];
  for (const id of ids) {
    const c: any = byId.get(id);
    const name = c?.name ?? 'Unknown';
    const necTotal = nec.get(id) ?? 0;
    const grossTotal = gross.get(id) ?? 0;
    if (c?.is_corporation) {
      if (grossTotal >= 600) excluded.push({ contact: name, total: grossTotal, reason: 'corporation — exempt from 1099-NEC' });
      continue;
    }
    if (necTotal >= 600) {
      required.push({ contact: name, contact_id: id, total: necTotal, tax_id_on_file: !!c?.tax_id_on_file, address: c?.address ?? null });
    } else if (grossTotal >= 600) {
      // Over $600 overall, but the reportable (non-1099-K) portion is under — the
      // processor reports the rest on 1099-K. Show it so it isn't invisible.
      excluded.push({ contact: name, total: grossTotal, reason: `${usdc(grossTotal - necTotal)} paid via card/app is reported on 1099-K by the processor` });
    }
  }
  required.sort((a, b) => b.total - a.total);
  const missing_w9 = required.filter((r) => !r.tax_id_on_file).map((r) => r.contact);
  return { year, required, excluded, missing_w9 };
}
function usdc(n: number) { return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
