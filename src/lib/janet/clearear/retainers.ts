// Clear Ear / BLVSTACK — retainers. Two ways a monthly retainer bills:
//   'invoice' (default) — the EXISTING recurring-invoice machinery: the retainer OWNS one
//     clearear_recurring row (linked UNIQUE), which the daily cron turns into a monthly draft invoice.
//   'stripe_subscription' — AUTOMATIC CARD CHARGE: no recurring row; the client signs up once on a
//     link and Stripe charges the card monthly (subscriptions.ts). Starts 'pending' until signup.
//
// MRR is read from THIS table only (active monthly_rate). The generated invoices are
// the actual billing and are NEVER also counted as MRR — that is the double-count the
// design avoids. A client can hold at most one active retainer (DB partial-unique).

import { supabaseAdmin } from '../../supabase';
import { assertBusiness, type Business } from './expenses';
import { setRecurring } from './recurring';
import { createCardSubscriptionRetainer, setCardSubscriptionStatus, signupUrl } from './subscriptions';

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The statuses Blue/JANET can SET. 'pending' (a card subscription waiting on signup) is only ever set by the system. */
export const RETAINER_STATUSES = ['active', 'paused', 'ended'] as const;
export type RetainerStatus = (typeof RETAINER_STATUSES)[number];
export type RetainerState = RetainerStatus | 'pending';
export const BILLING_METHODS = ['invoice', 'stripe_subscription'] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

export type CreateRetainerInput = {
  business: Business;
  contact_id: string;
  monthly_rate: number;
  start_date: string;
  notes?: string | null;
  /** payment methods to show on the generated invoices */
  payment_methods?: string[];
  /** 'invoice' (default) or 'stripe_subscription' (automatic card charge) */
  billing_method?: BillingMethod;
  actor?: string;
};

/** Open a monthly retainer for a client. Creates the backing recurring-invoice row
 *  (monthly, first issue = start_date) and links it 1:1. Refuses a second active
 *  retainer for the same client (also enforced by a DB partial-unique index).
 *  billing_method 'stripe_subscription' opens a pending card subscription instead. */
export async function createRetainer(input: CreateRetainerInput) {
  if (input.billing_method && !BILLING_METHODS.includes(input.billing_method)) throw new Error(`billing_method must be one of ${BILLING_METHODS.join('/')}.`);
  if (input.billing_method === 'stripe_subscription') {
    return createCardSubscriptionRetainer({ business: input.business, contact_id: input.contact_id, monthly_rate: input.monthly_rate, start_date: input.start_date, notes: input.notes ?? null });
  }
  const business = assertBusiness(input.business);
  const rate = round2(num(input.monthly_rate));
  if (!(rate > 0)) throw new Error('A retainer needs a positive monthly rate.');
  if (!input.start_date) throw new Error('A retainer needs a start date.');

  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name, business').eq('id', input.contact_id).maybeSingle();
  if (!contact) throw new Error(`No contact with id ${input.contact_id}.`);
  if (contact.business !== business) throw new Error(`Contact "${contact.name}" is a ${contact.business} contact — a ${business} retainer can only bill a ${business} contact.`);

  const { data: existing } = await supabaseAdmin.from('clearear_retainers').select('id, status').eq('contact_id', input.contact_id).in('status', ['active', 'pending']).limit(1).maybeSingle();
  if (existing) throw new Error(existing.status === 'pending'
    ? `"${contact.name}" has a card subscription waiting on signup. End it before opening another retainer.`
    : `"${contact.name}" already has an active retainer. Pause or end it before opening another.`);

  // The backing recurring-invoice row (monthly): one line = the retainer fee.
  const { recurring } = await setRecurring({
    business,
    contact_id: input.contact_id,
    frequency: 'monthly',
    next_issue_date: input.start_date,
    active: true,
    template: {
      lines: [{ description: 'Monthly retainer', service_label: 'Retainer', amount: rate }],
      payment_methods: input.payment_methods ?? [],
      notes: input.notes ?? null,
    },
  });

  const { data, error } = await supabaseAdmin.from('clearear_retainers').insert({
    business, contact_id: input.contact_id, monthly_rate: rate,
    start_date: input.start_date, status: 'active', recurring_id: recurring.id, notes: input.notes ?? null,
  }).select().single();
  if (error) {
    // Roll back the orphan recurring row if the retainer insert fails.
    await supabaseAdmin.from('clearear_recurring').delete().eq('id', recurring.id);
    throw new Error(error.message);
  }
  return data;
}

/** Change a retainer's status. Pausing/ending stops the recurring billing; ending
 *  stamps end_date. Reactivating turns the recurring row back on. */
export async function setRetainerStatus(id: string, status: RetainerStatus, endDate?: string | null) {
  if (!RETAINER_STATUSES.includes(status)) throw new Error(`status must be one of ${RETAINER_STATUSES.join('/')}.`);
  const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('id, recurring_id, contact_id, billing_method').eq('id', id).maybeSingle();
  if (!ret) throw new Error(`No retainer with id ${id}.`);
  // A card subscription's status follows Stripe: pausing/ending happens there first.
  if (ret.billing_method === 'stripe_subscription') return setCardSubscriptionStatus(id, status);

  // Reactivating requires no other active retainer for the client (DB will also block it).
  if (status === 'active') {
    const { data: other } = await supabaseAdmin.from('clearear_retainers').select('id').eq('contact_id', ret.contact_id).eq('status', 'active').neq('id', id).maybeSingle();
    if (other) throw new Error('That client already has another active retainer.');
  }

  const upd: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'ended') upd.end_date = endDate ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from('clearear_retainers').update(upd).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  // Billing follows status: only an active retainer keeps generating invoices.
  await supabaseAdmin.from('clearear_recurring').update({ active: status === 'active' }).eq('id', ret.recurring_id);
  return data;
}

/** List retainers for a business (or 'all'), with client name and collected-to-date. */
export async function listRetainers(opts: { business: Business | 'all'; status?: RetainerState }) {
  let q = supabaseAdmin
    .from('clearear_retainers')
    .select('id, business, contact_id, monthly_rate, start_date, status, end_date, recurring_id, billing_method, signup_token, subscription_status, current_period_end, last_payment_at, last_failure_at, last_failure_reason, past_due_since, clearear_contacts(name)')
    .order('created_at', { ascending: false });
  if (opts.business !== 'all') q = q.eq('business', assertBusiness(opts.business));
  if (opts.status) q = q.eq('status', opts.status);
  const { data } = await q;
  // the client sites each retainer pays for — they pause with it when it's past due (site-suspension.ts)
  const ids = ((data ?? []) as any[]).map((r) => r.id);
  const { data: siteRows } = ids.length
    ? await supabaseAdmin.from('janet_sites').select('billing_retainer_id, production_url, auto_suspend, suspend_grace_days, suspended_at').in('billing_retainer_id', ids)
    : { data: [] as any[] };
  const sitesFor = (id: string) => ((siteRows ?? []) as any[]).filter((s) => s.billing_retainer_id === id);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, business: r.business, contact_id: r.contact_id, contact_name: r.clearear_contacts?.name ?? null,
    monthly_rate: num(r.monthly_rate), start_date: r.start_date, status: r.status, end_date: r.end_date, recurring_id: r.recurring_id,
    billing_method: r.billing_method as BillingMethod,
    // card subscriptions: the signup link (only while it can still be used), Stripe's status, next charge, last failure
    signup_url: r.status === 'pending' && r.signup_token ? signupUrl(r.signup_token) : null,
    subscription_status: r.subscription_status ?? null, next_charge_at: r.status === 'active' ? r.current_period_end ?? null : null,
    last_payment_at: r.last_payment_at ?? null, last_failure_at: r.last_failure_at ?? null, last_failure_reason: r.last_failure_reason ?? null,
    past_due_since: r.past_due_since ?? null,
    sites: sitesFor(r.id).map((s) => ({ url: s.production_url, auto_pause: !!s.auto_suspend, paused: !!s.suspended_at })),
    // when the auto-pause sites go dark if it stays unpaid (shortest grace among them)
    pause_on: (() => {
      const auto = sitesFor(r.id).filter((s) => s.auto_suspend && !s.suspended_at);
      if (!r.past_due_since || !auto.length) return null;
      const days = Math.min(...auto.map((s) => Number(s.suspend_grace_days) || 7));
      return new Date(new Date(r.past_due_since).getTime() + days * 86_400_000).toISOString();
    })(),
  }));
}

/** MRR (active retainers only) + the split of collected revenue into recurring
 *  (from retainer/recurring-generated invoices) vs one-time. Revenue is COLLECTED
 *  money — MRR is a forward rate and is never added to it. */
export async function getRetainerMRR(opts: { business: Business | 'all' }) {
  const retainers = await listRetainers({ business: opts.business });
  const active = retainers.filter((r) => r.status === 'active');
  const mrr = round2(active.reduce((s, r) => s + r.monthly_rate, 0));

  // Recurring vs one-time collected: a payment is "recurring" when its invoice was
  // generated by a recurring row (invoice.recurring_id is set) or booked from a
  // card-subscription charge (invoice.retainer_id is set).
  let pq = supabaseAdmin
    .from('clearear_payments')
    .select('amount, voided_at, business, clearear_invoices(recurring_id, retainer_id)');
  if (opts.business !== 'all') pq = pq.eq('business', assertBusiness(opts.business));
  const { data: pays } = await pq;
  let recurring = 0, oneTime = 0;
  for (const p of (pays ?? []) as any[]) {
    if (p.voided_at) continue;
    const amt = num(p.amount);
    if (p.clearear_invoices?.recurring_id || p.clearear_invoices?.retainer_id) recurring += amt;
    else oneTime += amt;
  }
  return {
    business: opts.business,
    mrr, arr: round2(mrr * 12),
    active_count: active.length,
    revenue_recurring: round2(recurring),
    revenue_one_time: round2(oneTime),
    retainers,
  };
}
