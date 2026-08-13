import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { getBooks, get1099 } from '../../../../lib/janet/clearear/intelligence';

// CSV exports for a tax preparer. GET ?type=income|expenses|pl|mileage|1099 &year=YYYY
export const prerender = false;

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers: string[], rows: (unknown[])[]): string =>
  [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';

const addr1 = (a: any): string => {
  if (!a || typeof a !== 'object') return '';
  return [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), a.zip].filter(Boolean).join(' · ');
};

export const GET: APIRoute = async ({ url, locals }) => {
  if (!(locals as any).adminEmail) return new Response('Unauthorized', { status: 401 });
  const type = url.searchParams.get('type') || 'pl';
  const yearParam = url.searchParams.get('year');
  const year = yearParam && yearParam !== 'all' ? Number(yearParam) : null;
  const lo = year ? `${year}-01-01` : '0001-01-01';
  const hi = year ? `${year}-12-31` : '9999-12-31';
  const tag = year ?? 'all-time';

  let csv = '', fname = `clearear-${type}-${tag}.csv`;

  if (type === 'income') {
    const { data: pays } = await supabaseAdmin
      .from('clearear_payments')
      .select('paid_at, amount, method, reference, fee_amount, net_amount, voided_at, clearear_contacts(name), clearear_invoices(invoice_number)')
      .gte('paid_at', lo).lte('paid_at', hi).order('paid_at');
    csv = toCsv(
      ['Date', 'Contact', 'Invoice', 'Method', 'Reference', 'Gross', 'Fee', 'Net', 'Voided'],
      (pays ?? []).map((p: any) => [p.paid_at, p.clearear_contacts?.name ?? '', p.clearear_invoices?.invoice_number ?? '', p.method, p.reference ?? '', p.amount, p.fee_amount ?? '', p.net_amount ?? p.amount, p.voided_at ? 'YES' : '']),
    );
  } else if (type === 'expenses') {
    const { data: exps } = await supabaseAdmin
      .from('clearear_expenses')
      .select('spent_at, vendor, amount, method, reference, deductible, deductible_pct, is_owner_draw, system_generated, notes, clearear_expense_categories(label)')
      .gte('spent_at', lo).lte('spent_at', hi).order('spent_at');
    csv = toCsv(
      ['Date', 'Vendor', 'Category', 'Amount', 'Method', 'Reference', 'Deductible', 'Deductible %', 'Deductible $', 'Owner draw', 'Auto', 'Notes'],
      (exps ?? []).map((e: any) => {
        const ded = e.deductible && !e.is_owner_draw ? Math.round(Number(e.amount) * Number(e.deductible_pct)) / 100 : 0;
        return [e.spent_at, e.vendor, e.clearear_expense_categories?.label ?? '', e.amount, e.method, e.reference ?? '', e.deductible ? 'Y' : 'N', e.deductible_pct, ded, e.is_owner_draw ? 'Y' : '', e.system_generated ? 'Y' : '', e.notes ?? ''];
      }),
    );
  } else if (type === 'mileage') {
    const { data: miles } = await supabaseAdmin.from('clearear_mileage').select('drove_on, purpose, miles, rate_cents, start_location, end_location, notes').gte('drove_on', lo).lte('drove_on', hi).order('drove_on');
    csv = toCsv(
      ['Date', 'Purpose', 'Miles', 'Rate (¢/mi)', 'Deduction', 'From', 'To', 'Notes'],
      (miles ?? []).map((m: any) => [m.drove_on, m.purpose, m.miles, m.rate_cents, Math.round(Number(m.miles) * Number(m.rate_cents)) / 100, m.start_location ?? '', m.end_location ?? '', m.notes ?? '']),
    );
  } else if (type === 'pl') {
    const books = await getBooks({ year: year ?? undefined });
    const rows = Object.entries(books.by_month).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, v]) => [m, v.collected, v.expenses, v.net_cash]);
    rows.push(['TOTAL', books.collected, books.expenses_total, books.net_cash]);
    rows.push([]);
    rows.push(['Deductible expenses', books.deductible_expenses]);
    rows.push(['Mileage deduction', books.mileage_deduction]);
    rows.push(['Net taxable (est.)', books.net_taxable]);
    csv = toCsv(['Month', 'Collected', 'Expenses', 'Net cash'], rows);
  } else if (type === '1099') {
    if (!year) return new Response('1099 export requires a specific year', { status: 400 });
    const r = await get1099(year);
    const rows: unknown[][] = r.required.map((c) => [c.contact, c.total, c.tax_id_on_file ? 'Y' : 'MISSING W-9', addr1(c.address)]);
    if (r.excluded.length) {
      rows.push([]);
      rows.push(['— Excluded (not 1099-NEC) —']);
      for (const e of r.excluded) rows.push([e.contact, e.total, '', e.reason]);
    }
    csv = toCsv(['Contractor', 'Reportable total', 'W-9', 'Address / note'], rows);
  } else {
    return new Response('Unknown export type', { status: 400 });
  }

  return new Response(csv, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"`, 'Cache-Control': 'no-store' },
  });
};
