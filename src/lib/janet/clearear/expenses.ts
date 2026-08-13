// Clear Ear Books — expenses, recurring, mileage. Money OUT.
//
// Discipline mirrors the invoice side: idempotent creates through guardedCreate, and
// a PERIOD LOCK (A8) enforced HERE (server-side), so nothing dated on/before
// clearear_settings.books_closed_through can be inserted/edited/deleted. Corrections
// to a closed period must be posted as a current-period entry. System-generated rows
// (A10 — e.g. Stripe fees) are never mutable by the human/tool path.

import { supabaseAdmin } from '../../supabase';
import { guardedCreate, naturalKey } from '../write-executor';

export const EXPENSE_METHODS = ['cash', 'check', 'ach', 'card', 'cashapp', 'zelle', 'stripe', 'other'] as const;

/** The two businesses these books cover. One legal entity, separate books. */
export const BUSINESSES = ['clearear', 'blvstack'] as const;
export type Business = (typeof BUSINESSES)[number];
export function assertBusiness(b: unknown): Business {
  if (typeof b !== 'string' || !(BUSINESSES as readonly string[]).includes(b)) {
    throw new Error(`business must be one of: ${BUSINESSES.join(', ')} (got ${String(b)})`);
  }
  return b as Business;
}

// ── Period lock (ENTITY-LEVEL) ────────────────────────────────────────────
// One legal entity, one return, so ONE lock — books_entity_settings, never a
// per-business row. A per-business lock could close Clear Ear while BLVSTACK
// stayed open, leaving the combined filing P&L half-locked.
export async function booksClosedThrough(): Promise<string | null> {
  const { data } = await supabaseAdmin.from('books_entity_settings').select('books_closed_through').eq('id', 1).maybeSingle();
  return (data?.books_closed_through as string) ?? null;
}
async function assertOpenPeriod(dateStr: string, what: string): Promise<void> {
  const closed = await booksClosedThrough();
  if (closed && dateStr <= closed) {
    throw new Error(`Books are closed through ${closed}. ${what} dated ${dateStr} falls in a locked period — post a current-period adjusting entry instead of editing history.`);
  }
}

// ── Categories ────────────────────────────────────────────────────────────
export async function listExpenseCategories() {
  const { data } = await supabaseAdmin.from('clearear_expense_categories').select('*').eq('active', true).order('sort_order');
  return data ?? [];
}

// ── Expenses ──────────────────────────────────────────────────────────────
export type ExpenseInput = {
  business: Business;
  spent_at: string; vendor: string; amount: number; category_key: string; method: string;
  reference?: string | null; notes?: string | null;
  deductible?: boolean; deductible_pct?: number | null; is_owner_draw?: boolean;
  contractor_contact_id?: string | null; receipt_url?: string | null; created_by?: string;
};

export async function createExpense(input: ExpenseInput): Promise<{ expense: any; dedup: boolean }> {
  const business = assertBusiness(input.business);
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount === 0) throw new Error('An expense needs a non-zero amount.');
  const vendor = (input.vendor || '').trim();
  if (!vendor) throw new Error('An expense needs a vendor.');
  const spentAt = (input.spent_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) throw new Error('An expense needs a valid date (YYYY-MM-DD).');
  if (!(EXPENSE_METHODS as readonly string[]).includes(input.method)) throw new Error(`method must be one of: ${EXPENSE_METHODS.join(', ')}`);
  await assertOpenPeriod(spentAt, 'An expense');

  const { data: cat } = await supabaseAdmin.from('clearear_expense_categories').select('key, deductible_pct').eq('key', input.category_key).maybeSingle();
  if (!cat) throw new Error(`Unknown expense category "${input.category_key}".`);
  const deductible = input.deductible ?? true;
  const pct = input.deductible_pct != null ? Math.max(0, Math.min(100, Number(input.deductible_pct))) : Number(cat.deductible_pct);

  // business is part of the natural key: the same vendor/amount/date in BOTH
  // businesses is two real expenses, not a duplicate.
  const key = naturalKey('clearear_expense', [business, vendor, amount, spentAt, input.category_key]);
  const { row, dedup } = await guardedCreate<any>({
    actionType: 'clearear_expense', idempotencyKey: key, actor: input.created_by ?? 'blue',
    payload: { business, vendor, amount, spent_at: spentAt, category: input.category_key },
    create: async () => {
      const { data, error } = await supabaseAdmin.from('clearear_expenses').insert({
        business,
        spent_at: spentAt, vendor, amount, category_key: input.category_key, method: input.method,
        reference: input.reference ?? null, notes: input.notes ?? null,
        deductible, deductible_pct: pct, is_owner_draw: input.is_owner_draw ?? false,
        contractor_contact_id: input.contractor_contact_id ?? null, receipt_url: input.receipt_url ?? null,
        idempotency_key: key, created_by: input.created_by ?? 'blue',
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    reread: async (id) => (await supabaseAdmin.from('clearear_expenses').select('*').eq('id', id).maybeSingle()).data,
  });
  return { expense: row, dedup };
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>): Promise<any> {
  const { data: cur } = await supabaseAdmin.from('clearear_expenses').select('*').eq('id', id).maybeSingle();
  if (!cur) throw new Error('Expense not found.');
  if (cur.system_generated) throw new Error('This is a system-generated entry (e.g. a Stripe fee) — it can only change through the process that created it.');
  await assertOpenPeriod(cur.spent_at, 'This expense');
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.spent_at) { const d = patch.spent_at.slice(0, 10); await assertOpenPeriod(d, 'The new date'); p.spent_at = d; }
  if (patch.vendor !== undefined) p.vendor = (patch.vendor || '').trim();
  if (patch.amount !== undefined) { const a = Math.round(Number(patch.amount) * 100) / 100; if (!a) throw new Error('Amount must be non-zero.'); p.amount = a; }
  if (patch.category_key !== undefined) p.category_key = patch.category_key;
  if (patch.method !== undefined) p.method = patch.method;
  if (patch.reference !== undefined) p.reference = patch.reference || null;
  if (patch.notes !== undefined) p.notes = patch.notes || null;
  if (patch.deductible !== undefined) p.deductible = patch.deductible;
  if (patch.deductible_pct !== undefined && patch.deductible_pct != null) p.deductible_pct = Math.max(0, Math.min(100, Number(patch.deductible_pct)));
  if (patch.is_owner_draw !== undefined) p.is_owner_draw = patch.is_owner_draw;
  if (patch.contractor_contact_id !== undefined) p.contractor_contact_id = patch.contractor_contact_id || null;
  const { data, error } = await supabaseAdmin.from('clearear_expenses').update(p).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteExpense(id: string): Promise<{ deleted: boolean }> {
  const { data: cur } = await supabaseAdmin.from('clearear_expenses').select('id, spent_at, system_generated').eq('id', id).maybeSingle();
  if (!cur) throw new Error('Expense not found.');
  if (cur.system_generated) throw new Error('System-generated entry (e.g. a Stripe fee) — it cannot be deleted by hand; it reverses only through the process that created it.');
  await assertOpenPeriod(cur.spent_at, 'This expense');
  const { error } = await supabaseAdmin.from('clearear_expenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { deleted: true };
}

/** Expenses for ONE business. `business` is required — an unscoped list would mix
 *  two sets of books into a plausible-looking wrong total. Pass 'all' explicitly and
 *  knowingly for the combined (entity) view. */
export async function listExpenses(opts: { business: Business | 'all'; month?: string; category?: string; limit?: number }) {
  let q = supabaseAdmin.from('clearear_expenses').select('*, clearear_expense_categories(label)').order('spent_at', { ascending: false });
  if (opts.business !== 'all') q = q.eq('business', assertBusiness(opts.business));
  if (opts.month) q = q.gte('spent_at', `${opts.month}-01`).lte('spent_at', `${opts.month}-31`);
  if (opts.category) q = q.eq('category_key', opts.category);
  const { data } = await q.limit(opts.limit ?? 500);
  return data ?? [];
}

// ── Recurring ─────────────────────────────────────────────────────────────
export async function listRecurring(opts: { business: Business | 'all' }) {
  let q = supabaseAdmin.from('clearear_recurring_expenses').select('*').order('active', { ascending: false }).order('day_of_month');
  if (opts.business !== 'all') q = q.eq('business', assertBusiness(opts.business));
  const { data } = await q;
  return data ?? [];
}
export async function createRecurring(input: { business: Business; vendor: string; amount: number; category_key: string; method: string; day_of_month: number; notes?: string | null }) {
  const business = assertBusiness(input.business);
  const day = Math.max(1, Math.min(28, Math.round(Number(input.day_of_month) || 1)));
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (!input.vendor?.trim() || amount <= 0) throw new Error('Recurring needs a vendor and a positive amount.');
  const { data, error } = await supabaseAdmin.from('clearear_recurring_expenses').insert({
    business, vendor: input.vendor.trim(), amount, category_key: input.category_key, method: input.method, day_of_month: day, notes: input.notes ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function setRecurringActive(id: string, active: boolean) {
  await supabaseAdmin.from('clearear_recurring_expenses').update({ active }).eq('id', id);
  return { ok: true };
}

/** Post any recurring expense due this month that hasn't posted yet. Idempotent per
 *  (recurring id, month) — a re-run cannot double-post. Skips locked periods. */
export async function generateDueRecurring(today?: string): Promise<{ created: number }> {
  const t = (today ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const day = Number(t.slice(8, 10));
  const ym = t.slice(0, 7);
  const closed = await booksClosedThrough();
  const { data: recs } = await supabaseAdmin.from('clearear_recurring_expenses').select('*').eq('active', true);
  let created = 0;
  for (const r of recs ?? []) {
    if (r.day_of_month > day) continue;
    if (r.last_generated_on && String(r.last_generated_on).slice(0, 7) === ym) continue;
    const spentAt = `${ym}-${String(r.day_of_month).padStart(2, '0')}`;
    if (closed && spentAt <= closed) continue;
    const key = `recurring_expense:${r.id}:${ym}`;
    const { data: exists } = await supabaseAdmin.from('clearear_expenses').select('id').eq('idempotency_key', key).maybeSingle();
    if (!exists) {
      const { data: cat } = await supabaseAdmin.from('clearear_expense_categories').select('deductible_pct').eq('key', r.category_key).maybeSingle();
      const { error } = await supabaseAdmin.from('clearear_expenses').insert({
        business: r.business, // the posted expense belongs to the same books as its template
        spent_at: spentAt, vendor: r.vendor, amount: r.amount, category_key: r.category_key, method: r.method, notes: r.notes,
        deductible: true, deductible_pct: cat?.deductible_pct ?? 100, recurring_id: r.id, idempotency_key: key, created_by: 'recurring',
      });
      if (!error) created++;
    }
    await supabaseAdmin.from('clearear_recurring_expenses').update({ last_generated_on: spentAt }).eq('id', r.id);
  }
  return { created };
}

// ── Mileage (A4) ──────────────────────────────────────────────────────────
export async function listMileage(opts: { business: Business | 'all'; year?: number; limit?: number }) {
  let q = supabaseAdmin.from('clearear_mileage').select('*').order('drove_on', { ascending: false });
  if (opts.business !== 'all') q = q.eq('business', assertBusiness(opts.business));
  if (opts.year) q = q.gte('drove_on', `${opts.year}-01-01`).lte('drove_on', `${opts.year}-12-31`);
  const { data } = await q.limit(opts.limit ?? 500);
  return data ?? [];
}
export async function createMileage(input: { business: Business; drove_on: string; purpose: string; miles: number; rate_cents: number; start_location?: string | null; end_location?: string | null; notes?: string | null }) {
  const business = assertBusiness(input.business);
  const drove = (input.drove_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drove)) throw new Error('Mileage needs a valid date.');
  const miles = Number(input.miles);
  if (!(miles > 0)) throw new Error('Miles must be greater than zero.');
  const rate = Math.round(Number(input.rate_cents));
  if (!(rate > 0)) throw new Error('A per-mile rate (cents) is required — use the IRS standard rate for that tax year.');
  if (!input.purpose?.trim()) throw new Error('Mileage needs a business purpose.');
  await assertOpenPeriod(drove, 'Mileage');
  const { data, error } = await supabaseAdmin.from('clearear_mileage').insert({
    business,
    drove_on: drove, purpose: input.purpose.trim(), miles, rate_cents: rate,
    start_location: input.start_location ?? null, end_location: input.end_location ?? null, notes: input.notes ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function deleteMileage(id: string) {
  const { data: cur } = await supabaseAdmin.from('clearear_mileage').select('id, drove_on').eq('id', id).maybeSingle();
  if (!cur) throw new Error('Mileage entry not found.');
  await assertOpenPeriod(cur.drove_on, 'This mileage entry');
  await supabaseAdmin.from('clearear_mileage').delete().eq('id', id);
  return { deleted: true };
}
