// Clear Ear Studios - studio intelligence (Phase 3.3/3.4). Every number comes from
// real rows: payments (money actually collected), invoices/lines (what was billed),
// sessions, contacts. Billed and collected are kept DISTINCT and labeled - a
// service's "billed" is not the same as "collected", and we never blur them or
// estimate. Unknowns are stated, not guessed.

import { supabaseAdmin } from '../../supabase';

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
export async function getStudioIntelligence(opts: { year?: number; lapsedDays?: number } = {}): Promise<StudioIntelligence> {
  const lapsedDays = opts.lapsedDays ?? 60;
  const yearPrefix = opts.year ? String(opts.year) : null;
  const today = new Date().toISOString().slice(0, 10);

  const [paysRes, invRes, linesRes, sessRes, contactsRes] = await Promise.all([
    // voided payments are excluded from collected revenue (they belong to a voided invoice)
    supabaseAdmin.from('clearear_payments').select('amount, method, paid_at, contact_id').is('voided_at', null),
    supabaseAdmin.from('clearear_invoices').select('id, contact_id, status, issue_date, due_date, total, balance').neq('status', 'void'),
    supabaseAdmin.from('clearear_invoice_lines').select('amount, service_label, invoice_id'),
    supabaseAdmin.from('clearear_sessions').select('contact_id, session_date'),
    supabaseAdmin.from('clearear_contacts').select('id, name, status'),
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
    supabaseAdmin.from('clearear_invoices').select('balance, due_date, status').gt('balance', 0).not('status', 'in', '(void,paid)'),
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
