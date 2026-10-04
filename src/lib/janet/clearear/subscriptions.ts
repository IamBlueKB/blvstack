// BLV Books — AUTOMATIC MONTHLY CARD CHARGES for retainers (Stripe subscriptions).
//
// A retainer with billing_method 'stripe_subscription' has no recurring-invoice row. It opens 'pending' with a
// signup link (/subscribe/<token>). The client opens the link, adds a card once on Stripe Checkout, and Stripe
// charges that card every month from the first charge date. Every PAID Stripe invoice lands in the books as its
// own BLV invoice — paid, payment at gross, processing fee as an expense — through the same money path as the
// invoice Pay button (recordStripePayment). MRR still reads only the retainer's monthly_rate (active only).
//
// Stripe owns the subscription; the retainer mirrors it from the webhook (status, next charge, last failure).
// Webhook payloads arrive in the account's default API version, so every handler re-reads the object with the
// pinned client and trusts only what it reads back. Only subscriptions this code started (metadata.kind) are
// ever touched — the Stripe account is shared with other products.

import { randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { supabaseAdmin } from '../../supabase';
import { stripe } from '../../clearear/stripe';
import { recordStripePayment } from '../../clearear/stripe-payments';
import { assertBusiness, type Business } from './expenses';
import { createInvoice } from './invoicing';
import { voidInvoice } from './reversal';
import { onChargeFailed, onChargePaid } from './dunning';
import { recordBillingEvent, notifyOwner, planContext } from './billing-events';

const BASE = (import.meta as any).env?.PUBLIC_SITE_URL || 'https://blvstack.com';
export const SUB_KIND = 'retainer_subscription';
export const CARD_UPDATE_KIND = 'retainer_card_update';

const TZ = 'America/Chicago';
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const localDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD, Blue's day
const isoOf = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);
const idOf = (v: unknown) => (typeof v === 'string' ? v : ((v as { id?: string } | null)?.id ?? null));
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const STOPPED = new Set(['canceled', 'incomplete_expired']);

export const signupUrl = (token: string) => `${BASE}/subscribe/${token}`;

export class SignupError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** A client keeps ONE live retainer: an active one, or a card subscription waiting on signup. */
async function liveRetainerFor(contactId: string, exceptId?: string) {
  let q = supabaseAdmin.from('clearear_retainers').select('id, status').eq('contact_id', contactId).in('status', ['active', 'pending']);
  if (exceptId) q = q.neq('id', exceptId);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

async function updateRetainer(id: string, upd: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('clearear_retainers').update({ ...upd, updated_at: nowIso() }).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function businessName(business: string) {
  const { data } = await supabaseAdmin.from('clearear_settings').select('business_name').eq('business', business).maybeSingle();
  return data?.business_name || (business === 'blvstack' ? 'BLVSTACK' : 'Clear Ear Studios');
}

// ── Opening one ───────────────────────────────────────────────────────────

export type CardSubscriptionInput = {
  business: Business;
  contact_id: string;
  monthly_rate: number;
  /** the first charge date */
  start_date: string;
  notes?: string | null;
};

/** Open a card-subscription retainer: 'pending' + a signup link. Nothing is created in Stripe and nothing is
 *  charged until the client opens the link and adds a card. */
export async function createCardSubscriptionRetainer(input: CardSubscriptionInput) {
  const business = assertBusiness(input.business);
  const rate = round2(num(input.monthly_rate));
  if (!(rate > 0)) throw new Error('A retainer needs a positive monthly rate.');
  if (rate < 0.5) throw new Error('Stripe can’t charge less than $0.50 a month.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date ?? '')) throw new Error('A card subscription needs its first charge date (YYYY-MM-DD).');

  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name, business').eq('id', input.contact_id).maybeSingle();
  if (!contact) throw new Error(`No contact with id ${input.contact_id}.`);
  if (contact.business !== business) throw new Error(`Contact "${contact.name}" is a ${contact.business} contact — a ${business} retainer can only bill a ${business} contact.`);
  const live = await liveRetainerFor(contact.id);
  if (live) throw new Error(`"${contact.name}" already has ${live.status === 'pending' ? 'a card subscription waiting on signup' : 'an active retainer'}. End it before opening another.`);

  const token = randomBytes(18).toString('base64url');
  const { data, error } = await supabaseAdmin.from('clearear_retainers').insert({
    business, contact_id: contact.id, monthly_rate: rate, start_date: input.start_date,
    status: 'pending', billing_method: 'stripe_subscription', recurring_id: null, signup_token: token,
    notes: input.notes ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return { ...data, signup_url: signupUrl(token) };
}

/** When the first charge falls. A start date of today (Blue's day) or earlier charges at signup. A later date
 *  bills ON that date, mid-morning Central: up to one month out by anchoring the billing cycle there (nothing
 *  due at signup, no proration — Stripe allows an anchor up to the next natural billing date, verified in test
 *  mode); further out as a trial ending on it (Stripe wants a trial ≥ 48h out — it is). */
export type FirstCharge = { kind: 'now' } | { kind: 'anchor' | 'trial'; at: number; date: string };
export function firstCharge(startDate: string, now = new Date()): FirstCharge {
  if (!startDate || startDate <= localDate(now)) return { kind: 'now' };
  const at = Math.floor(Date.parse(`${startDate}T15:00:00Z`) / 1000);
  // 1h margin under the natural billing date for clock skew between us and Stripe
  return { kind: at * 1000 < oneMonthAfter(now).getTime() - 3_600_000 ? 'anchor' : 'trial', at, date: startDate };
}

/** Same day next month, clamped to the month's last day (Jan 31 → Feb 28) — Stripe's next natural billing date. */
function oneMonthAfter(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return t;
}

// ── The public signup page ────────────────────────────────────────────────

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

async function retainerByToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await supabaseAdmin.from('clearear_retainers').select('*, clearear_contacts(name, email)').eq('signup_token', token).maybeSingle();
  if (!data || data.billing_method !== 'stripe_subscription') return null;
  return data as any;
}

/** What /subscribe/<token> shows. Null when the link is unknown. */
export async function getSignupView(token: string) {
  const ret = await retainerByToken(token);
  if (!ret) return null;
  const { data: settings } = await supabaseAdmin.from('clearear_settings').select('business_name, email, phone').eq('business', ret.business).maybeSingle();
  return {
    retainer: {
      business: ret.business as Business, monthly_rate: num(ret.monthly_rate), start_date: ret.start_date as string,
      status: ret.status as string, subscription_status: ret.subscription_status as string | null, current_period_end: ret.current_period_end as string | null,
      // a failed charge the client can fix from this page (update card → retried at once)
      past_due: !!ret.past_due_since || ['past_due', 'unpaid'].includes(ret.subscription_status ?? ''),
      can_update_card: !!ret.stripe_subscription_id && ret.status !== 'ended',
    },
    contact: ret.clearear_contacts as { name: string; email: string | null } | null,
    settings,
    first: firstCharge(ret.start_date),
  };
}

async function expireOpenCheckouts(customerId: string) {
  const s = stripe();
  const open = await s.checkout.sessions.list({ customer: customerId, status: 'open', limit: 20 });
  for (const o of open.data) await s.checkout.sessions.expire(o.id).catch(() => {});
}

/** Start Stripe Checkout (mode=subscription) for a pending card retainer. The amount and dates come from the
 *  retainer, never the browser. One Stripe customer and one price per retainer, reused on every attempt. */
export async function startSubscriptionCheckout(token: string, origin: string): Promise<string> {
  const ret = await retainerByToken(token);
  if (!ret) throw new SignupError('This link isn’t valid.', 404);
  if (ret.status === 'ended') throw new SignupError('This plan has ended.', 410);
  if (ret.status !== 'pending' || ret.stripe_subscription_id) throw new SignupError('Automatic payments are already set up for this plan.', 409);
  if (await liveRetainerFor(ret.contact_id, ret.id)) throw new SignupError('This plan can’t be started right now — please get in touch with us.', 409);

  const s = stripe();
  const contact = ret.clearear_contacts ?? {};
  const bizName = await businessName(ret.business);
  const meta = { kind: SUB_KIND, retainer_id: ret.id, contact_id: ret.contact_id, business: ret.business };

  // 1. The Stripe customer — one per retainer.
  let customerId: string | null = ret.stripe_customer_id;
  if (!customerId) {
    const c = await s.customers.create(
      { name: contact.name ?? undefined, email: contact.email ?? undefined, metadata: meta },
      { idempotencyKey: `retainer-customer:${ret.id}` },
    );
    customerId = c.id;
    await updateRetainer(ret.id, { stripe_customer_id: customerId });
  } else {
    // Webhook-lag guard: if this customer already holds a live subscription we started, link it — never a second.
    const subs = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
    const live = subs.data.find((x) => x.metadata?.retainer_id === ret.id && !STOPPED.has(x.status) && x.status !== 'incomplete');
    if (live) {
      await syncSubscription(live.id);
      throw new SignupError('Automatic payments are already set up for this plan.', 409);
    }
  }

  // 2. The price — fixed at the retainer's rate.
  const cents = Math.round(num(ret.monthly_rate) * 100);
  let priceId: string | null = ret.stripe_price_id;
  if (priceId) {
    const p = await s.prices.retrieve(priceId).catch(() => null);
    if (!p || !p.active || p.unit_amount !== cents || p.recurring?.interval !== 'month') priceId = null;
  }
  if (!priceId) {
    // The product's statement descriptor is what the card statement shows for these charges — the brand, not
    // the account default ("CEC.."). Same per-business brand as the invoice Pay button's descriptor suffix.
    const p = await s.prices.create(
      {
        currency: 'usd', unit_amount: cents, recurring: { interval: 'month' },
        product_data: { name: `${bizName} monthly plan`, metadata: meta, statement_descriptor: ret.business === 'blvstack' ? 'BLVSTACK' : 'CLEAR EAR STUDIOS' },
        metadata: meta,
      },
      { idempotencyKey: `retainer-price:${ret.id}:${cents}` },
    );
    priceId = p.id;
    await updateRetainer(ret.id, { stripe_price_id: priceId });
  }

  // 3. One open checkout per link — a second tab can't start a second subscription.
  await expireOpenCheckouts(customerId);

  // 4. Stripe-hosted checkout; no card data touches BLVSTACK.
  const first = firstCharge(ret.start_date);
  const back = `${origin}/subscribe/${token}`;
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ['card'],
    metadata: meta,
    subscription_data: {
      description: `${bizName} monthly plan — ${contact.name ?? 'client'}`,
      metadata: meta,
      ...(first.kind === 'anchor' ? { billing_cycle_anchor: first.at, proration_behavior: 'none' as const } : {}),
      ...(first.kind === 'trial' ? { trial_end: first.at } : {}),
    },
    success_url: `${back}?stripe=processing`,
    cancel_url: back,
  });
  if (!session.url) throw new SignupError('Could not open checkout — please try again.', 502);
  return session.url;
}

// ── Webhook: mirroring Stripe onto the retainer ───────────────────────────

/** Which retainer a subscription belongs to. Linked ones by id; on first sight (event order isn't guaranteed)
 *  only a subscription our Checkout started, for an unlinked card retainer. Null = not ours. */
async function retainerForSubscription(sub: Stripe.Subscription) {
  const { data: linked } = await supabaseAdmin.from('clearear_retainers').select('*').eq('stripe_subscription_id', sub.id).maybeSingle();
  if (linked) return linked;
  const rid = sub.metadata?.kind === SUB_KIND ? sub.metadata?.retainer_id : null;
  if (!rid) return null;
  const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('*').eq('id', rid).maybeSingle();
  if (!ret || ret.billing_method !== 'stripe_subscription') return null;
  if (ret.stripe_subscription_id && ret.stripe_subscription_id !== sub.id) {
    // A SECOND subscription from the same link — never linked or booked; flagged for Blue.
    if (!STOPPED.has(sub.status)) {
      await updateRetainer(ret.id, { last_failure_at: nowIso(), last_failure_reason: `A second Stripe subscription (${sub.id}) was started from this signup link — cancel and refund it in Stripe.` });
    }
    return null;
  }
  return ret;
}

function retainerStatusFor(sub: Stripe.Subscription, current: string): string {
  if (current === 'ended') return 'ended';                 // a canceled subscription never comes back
  if (STOPPED.has(sub.status)) return 'ended';
  if (sub.status === 'incomplete') return 'pending';        // first payment still needs the client (e.g. 3-D Secure)
  if (sub.status === 'paused' || sub.pause_collection) return 'paused';
  return 'active';                                          // trialing | active | past_due | unpaid — failures show via last_failure_*
}

/** Re-read a subscription and mirror it onto its retainer, linking it on first sight. Returns the retainer, or
 *  null when the subscription isn't one of ours. */
export async function syncSubscription(subId: string) {
  const sub = await stripe().subscriptions.retrieve(subId);
  const ret = await retainerForSubscription(sub);
  if (!ret) return null;

  const upd: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: idOf(sub.customer),
    stripe_price_id: sub.items?.data?.[0]?.price?.id ?? ret.stripe_price_id,
    subscription_status: sub.status,
    current_period_end: isoOf(sub.current_period_end),
    updated_at: nowIso(),
  };
  const next = retainerStatusFor(sub, ret.status);
  if (next !== ret.status) {
    upd.status = next;
    if (next === 'ended') upd.end_date = (isoOf(sub.ended_at ?? sub.canceled_at) ?? nowIso()).slice(0, 10);
  }
  if (ret.status === 'ended' && !STOPPED.has(sub.status)) {
    // Ending cancels the subscription, so this shouldn't happen — flagged, never revived.
    upd.last_failure_at = nowIso();
    upd.last_failure_reason = `This retainer is ended but its Stripe subscription ${sub.id} is still ${sub.status} — cancel it in Stripe.`;
  }

  let { data, error } = await supabaseAdmin.from('clearear_retainers').update(upd).eq('id', ret.id).select().single();
  if (error && upd.status === 'active' && /duplicate key|unique/i.test(error.message)) {
    // Another retainer for this client is still active (one live retainer per client): keep the link, hold the status, say why.
    delete upd.status;
    upd.last_failure_at = nowIso();
    upd.last_failure_reason = 'The card subscription is live, but another retainer for this client is still active — end that one and this shows active.';
    ({ data, error } = await supabaseAdmin.from('clearear_retainers').update(upd).eq('id', ret.id).select().single());
  }
  if (error) throw new Error(`retainer sync: ${error.message}`);
  if (upd.status) await onPlanTransition(ret, upd.status as string, sub);
  return data;
}

/** A plan changed state from Stripe's side — log it on the account; tell Blue about the ones he didn't do himself
 *  (his own Pause/Resume/End are recorded by setCardSubscriptionStatus and already change the status first). */
async function onPlanTransition(ret: any, next: string, sub: Stripe.Subscription) {
  const minute = new Date().toISOString().slice(0, 16);
  if (ret.status === 'pending' && next === 'active') {
    // same rule the signup used: a start date still ahead = first charge then; otherwise charged at signup
    const plan = firstCharge(ret.start_date);
    const first = plan.kind === 'now' ? null : new Date(plan.at * 1000).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
    const isNew = await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'signed_up', ref: sub.id, amount: num(ret.monthly_rate), detail: first ? `First charge ${first}` : 'Charged at signup' });
    if (isNew) {
      const ctx = await planContext(ret.id);
      if (ctx) await notifyOwner(`signed_up:${ret.id}`, `✓ ${ctx.name} set up automatic payments`, [
        `${ctx.name} added their card — ${ctx.rate}/month, charged automatically.`,
        first ? `First charge: ${first}.` : 'The first charge went through at signup.',
        ...(ctx.sites.length ? [`Site: ${ctx.sites.map((s) => s.production_url.replace(/^https?:\/\//, '')).join(', ')}`] : []),
      ], ctx.links);
    }
  } else if (next === 'paused') {
    await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'plan_paused', ref: `${sub.id}:paused:${minute}`, detail: 'Billing paused in Stripe' });
  } else if (ret.status === 'paused' && next === 'active') {
    await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'plan_resumed', ref: `${sub.id}:resumed:${minute}`, detail: 'Billing resumed' });
  } else if (next === 'ended' && ret.status !== 'ended') {
    const isNew = await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'plan_ended', ref: `${sub.id}:ended`, detail: sub.cancellation_details?.reason === 'payment_failed' ? 'Stripe canceled it after the card kept failing' : 'Canceled in Stripe' });
    if (isNew) {
      const ctx = await planContext(ret.id);
      if (ctx) await notifyOwner(`plan_ended:${ret.id}`, `${ctx.name}’s card plan ended`, [
        `${ctx.name}’s ${ctx.rate}/month card plan was canceled on Stripe’s side${sub.cancellation_details?.reason === 'payment_failed' ? ' after the card kept failing' : ''}.`,
        'Nothing more will be charged. Their site stays as it is — paused if it was paused.',
      ], ctx.links);
    }
  }
}

function periodLabel(startUnix: number, endUnix: number) {
  const year = (u: number) => new Date(u * 1000).toLocaleDateString('en-US', { timeZone: TZ, year: 'numeric' });
  const day = (u: number, withYear: boolean) =>
    new Date(u * 1000).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}) });
  return `${day(startUnix, year(startUnix) !== year(endUnix))} – ${day(endUnix, true)}`;
}

/** One BLV invoice per paid Stripe invoice, linked to the retainer and the Stripe invoice. */
async function bookStripeInvoice(ret: any, inv: Stripe.Invoice): Promise<string> {
  const { data: existing } = await supabaseAdmin.from('clearear_invoices').select('id').eq('stripe_invoice_id', inv.id).maybeSingle();
  if (existing) return existing.id;

  const line = inv.lines?.data?.[0];
  const base = line?.period ? `Monthly plan · ${periodLabel(line.period.start, line.period.end)}` : 'Monthly plan';
  // createInvoice is idempotent on (client, day, total, lines). Two different Stripe invoices can only share that
  // key on a same-day re-signup — the second pass carries the Stripe number so it can't collide.
  for (const description of [base, `${base} · ${inv.number ?? inv.id}`]) {
    const created: any = await createInvoice({
      business: ret.business,
      contact_id: ret.contact_id,
      lines: [{ description, service_label: 'Retainer', amount: inv.amount_paid / 100 }],
      due_date: today(),
      payment_methods: [],
      notes: `Charged automatically to the card on file — Stripe ${inv.number ?? inv.id}.`,
      actor: 'stripe',
    });
    const id = created.invoice?.id as string;
    const { data: claimed } = await supabaseAdmin
      .from('clearear_invoices')
      .update({ retainer_id: ret.id, stripe_invoice_id: inv.id, updated_at: nowIso() })
      .eq('id', id).is('stripe_invoice_id', null)
      .select('id').maybeSingle();
    if (claimed) return claimed.id;
    // Not claimable: a concurrent delivery of this same event got there first…
    const { data: mine } = await supabaseAdmin.from('clearear_invoices').select('id').eq('stripe_invoice_id', inv.id).maybeSingle();
    if (mine) {
      const { data: ours } = await supabaseAdmin.from('clearear_invoices').select('stripe_invoice_id').eq('id', id).maybeSingle();
      if (mine.id !== id && ours && !ours.stripe_invoice_id) await voidInvoice(id, `Duplicate of the card charge booked on another invoice (Stripe ${inv.id}).`, 'stripe');
      return mine.id;
    }
    // …or the natural key matched another Stripe invoice's books row — go round once more with a unique line.
  }
  throw new Error(`Could not book Stripe invoice ${inv.id}.`);
}

/** invoice.paid — a monthly charge went through. Books it once: its own BLV invoice, the payment at gross, the
 *  fee as an expense. A $0 invoice (charging starts later) books nothing. */
export async function onSubscriptionInvoicePaid(invoiceId: string) {
  const inv = await stripe().invoices.retrieve(invoiceId);
  const subId = idOf(inv.subscription);
  if (!subId) return;                         // not a subscription invoice
  const ret = await syncSubscription(subId);
  if (!ret) return;                           // not one of ours
  if (!(inv.amount_paid > 0)) return;
  const piId = idOf(inv.payment_intent);
  if (!piId) {
    console.warn('[subscriptions] paid Stripe invoice has no PaymentIntent — not booked', inv.id);
    return;
  }
  const paidAt = inv.status_transitions?.paid_at ?? inv.created;
  const blvId = await bookStripeInvoice(ret, inv);
  await recordStripePayment({ invoiceId: blvId, piId, amountCents: inv.amount_paid, paidAtUnix: paidAt });
  await updateRetainer(ret.id, { last_payment_at: isoOf(paidAt), last_failure_at: null, last_failure_reason: null });
  const line = inv.lines?.data?.[0];
  await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'charge_paid', ref: inv.id, amount: inv.amount_paid / 100, detail: line?.period ? `Monthly plan · ${periodLabel(line.period.start, line.period.end)}` : 'Monthly plan' });
  await onChargePaid(ret.id); // was behind? → bring back a paused site, tell the client they're all set
}

/** invoice.payment_failed — a charge was declined. Recorded on the retainer (admin + JANET's snapshot show it);
 *  Stripe keeps retrying on its own schedule, and the next good charge clears it. */
export async function onSubscriptionInvoiceFailed(invoiceId: string) {
  const inv = await stripe().invoices.retrieve(invoiceId, { expand: ['payment_intent'] });
  const subId = idOf(inv.subscription);
  if (!subId) return;
  const ret = await syncSubscription(subId);
  if (!ret) return;
  const pi = (inv.payment_intent && typeof inv.payment_intent === 'object' ? inv.payment_intent : null) as Stripe.PaymentIntent | null;
  const err = pi?.last_payment_error;
  const why = err?.message || (err?.decline_code ? `Card declined (${err.decline_code})` : 'The card charge failed');
  const retry = inv.next_payment_attempt ? ` Stripe retries ${localDate(new Date(inv.next_payment_attempt * 1000))}.` : ' No more automatic retries.';
  await updateRetainer(ret.id, { last_failure_at: nowIso(), last_failure_reason: `${why} — ${usd(inv.amount_due / 100)}.${retry}`.slice(0, 400) });
  await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'charge_failed', ref: `${inv.id}:${inv.attempt_count}`, amount: inv.amount_due / 100, detail: `${why.replace(/\.$/, '')}.${retry}` });
  await onChargeFailed(ret.id, { why: err?.message ?? null }); // start the grace clock + tell the client (once)
}

// ── The client's card update (from their billing page) ─────────────────────

/** Open Stripe Checkout in setup mode so the client can put a new card on file. When it completes, the webhook makes
 *  it the card for the subscription and retries any unpaid invoice right away. */
export async function startCardUpdate(token: string, origin: string): Promise<string> {
  const ret = await retainerByToken(token);
  if (!ret) throw new SignupError('This link isn’t valid.', 404);
  if (ret.status === 'ended') throw new SignupError('This plan has ended.', 410);
  if (!ret.stripe_customer_id || !ret.stripe_subscription_id) throw new SignupError('Automatic payments aren’t set up yet — use the button above to set them up.', 409);
  const back = `${origin}/subscribe/${token}`;
  const meta = { kind: CARD_UPDATE_KIND, retainer_id: ret.id };
  await expireOpenCheckouts(ret.stripe_customer_id);
  const session = await stripe().checkout.sessions.create({
    mode: 'setup',
    customer: ret.stripe_customer_id,
    payment_method_types: ['card'],
    metadata: meta,
    setup_intent_data: { metadata: meta },
    success_url: `${back}?card=updated`,
    cancel_url: back,
  });
  if (!session.url) throw new SignupError('Could not open the card form — please try again.', 502);
  return session.url;
}

/** checkout.session.completed (mode=setup): the new card becomes the subscription's card, then any open invoice is
 *  charged to it now — success arrives as invoice.paid (books it, restores a paused site). */
export async function onCardUpdateCompleted(sessionId: string) {
  const s = stripe();
  const sess = await s.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
  if (sess.mode !== 'setup' || sess.metadata?.kind !== CARD_UPDATE_KIND) return;
  const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('*').eq('id', sess.metadata?.retainer_id ?? '').maybeSingle();
  if (!ret?.stripe_subscription_id) return;
  const si = sess.setup_intent as Stripe.SetupIntent | null;
  const pm = idOf(si?.payment_method);
  const customer = idOf(sess.customer) ?? ret.stripe_customer_id;
  if (!pm || !customer) return;
  await s.customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  const sub = await s.subscriptions.update(ret.stripe_subscription_id, { default_payment_method: pm });
  const card = await s.paymentMethods.retrieve(pm).then((p) => p.card).catch(() => null);
  await recordBillingEvent({ retainer_id: ret.id, contact_id: ret.contact_id, kind: 'card_updated', ref: sess.id, detail: card ? `New card on file: ${card.brand} ending ${card.last4}` : 'New card on file' });
  if (STOPPED.has(sub.status)) return;
  const open = await s.invoices.list({ subscription: sub.id, status: 'open', limit: 10 });
  for (const inv of open.data) {
    if (!(inv.amount_remaining > 0)) continue;
    try { await s.invoices.pay(inv.id, { payment_method: pm }); }
    catch (e) { console.warn('[subscriptions] retry after card update failed', inv.id, (e as Error).message); } // invoice.payment_failed records it
  }
}

/** customer.subscription.created/updated/deleted — mirror it. */
export async function onSubscriptionChanged(subId: string) {
  await syncSubscription(subId);
}

// ── Blue's controls (admin Retainers page) ────────────────────────────────

/** Pause stops charging (Stripe voids the months in between), Resume picks the cycle back up, End cancels in
 *  Stripe immediately — no further charges, nothing refunded. A pending one can only be ended (its link dies). */
export async function setCardSubscriptionStatus(id: string, to: 'active' | 'paused' | 'ended') {
  const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('*').eq('id', id).maybeSingle();
  if (!ret) throw new Error(`No retainer with id ${id}.`);
  if (ret.billing_method !== 'stripe_subscription') throw new Error('Not a card subscription.');
  if (ret.status === to) return ret;
  if (ret.status === 'ended') throw new Error('This card subscription has ended — a canceled Stripe subscription can’t restart. Open a new one and send the client the new link.');
  const s = stripe();

  if (ret.status === 'pending') {
    if (to !== 'ended') throw new Error('Still waiting on the client to add a card — send them the signup link. There’s nothing to pause or activate yet.');
    if (ret.stripe_customer_id) await expireOpenCheckouts(ret.stripe_customer_id);
    return updateRetainer(id, { status: 'ended', end_date: today() });
  }

  const subId = ret.stripe_subscription_id as string;
  const minute = new Date().toISOString().slice(0, 16);
  if (to === 'ended') {
    const sub = await s.subscriptions.retrieve(subId);
    const after = STOPPED.has(sub.status) ? sub : await s.subscriptions.cancel(subId);
    const row = await updateRetainer(id, { status: 'ended', end_date: today(), subscription_status: after.status });
    await recordBillingEvent({ retainer_id: id, contact_id: ret.contact_id, kind: 'plan_ended', ref: `${subId}:ended`, detail: 'Ended from the admin — canceled in Stripe, nothing refunded' });
    return row;
  }
  if (to === 'paused') {
    const sub = await s.subscriptions.update(subId, { pause_collection: { behavior: 'void' } });
    const row = await updateRetainer(id, { status: 'paused', subscription_status: sub.status, current_period_end: isoOf(sub.current_period_end) });
    await recordBillingEvent({ retainer_id: id, contact_id: ret.contact_id, kind: 'plan_paused', ref: `${subId}:paused:${minute}`, detail: 'Paused from the admin' });
    return row;
  }
  if (await liveRetainerFor(ret.contact_id, id)) throw new Error('That client already has another active retainer.');
  const sub = await s.subscriptions.update(subId, { pause_collection: '' });
  const row = await updateRetainer(id, { status: 'active', subscription_status: sub.status, current_period_end: isoOf(sub.current_period_end) });
  await recordBillingEvent({ retainer_id: id, contact_id: ret.contact_id, kind: 'plan_resumed', ref: `${subId}:resumed:${minute}`, detail: 'Resumed from the admin' });
  return row;
}

// ── JANET ─────────────────────────────────────────────────────────────────

/** One compact line for JANET's snapshot: every live card subscription, flagging failed charges. Null when none. */
export async function getCardSubscriptionsSnapshotLine(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('clearear_retainers')
    .select('id, business, status, monthly_rate, subscription_status, current_period_end, last_failure_at, last_failure_reason, past_due_since, clearear_contacts(name)')
    .eq('billing_method', 'stripe_subscription')
    .neq('status', 'ended');
  if (!data?.length) return null;
  const { data: siteRows } = await supabaseAdmin.from('janet_sites')
    .select('billing_retainer_id, production_url, auto_suspend, suspend_grace_days, suspended_at')
    .in('billing_retainer_id', (data as any[]).map((r) => r.id));
  const parts = (data as any[]).map((r) => {
    const who = `${r.clearear_contacts?.name ?? 'client'} ${usd(num(r.monthly_rate))}/mo (${r.business})`;
    if (r.status === 'pending') return `${who} — waiting on the client to add a card (signup link)`;
    const sub = r.subscription_status && r.subscription_status !== 'active' ? `/${r.subscription_status}` : '';
    const next = r.status === 'active' && r.current_period_end ? `, next charge ${localDate(new Date(r.current_period_end))}` : '';
    const failed = r.last_failure_at ? ` — LAST CHARGE FAILED: ${r.last_failure_reason ?? 'see Stripe'}` : '';
    const sites = ((siteRows ?? []) as any[]).filter((s) => s.billing_retainer_id === r.id);
    const paused = sites.filter((s) => s.suspended_at).map((s) => s.production_url);
    const auto = sites.filter((s) => s.auto_suspend && !s.suspended_at);
    const pauseOn = r.past_due_since && auto.length
      ? localDate(new Date(new Date(r.past_due_since).getTime() + Math.min(...auto.map((s) => Number(s.suspend_grace_days) || 7)) * 86_400_000))
      : null;
    const dunning = paused.length ? ` — SITE PAUSED for non-payment: ${paused.join(', ')}`
      : pauseOn ? ` — PAST DUE since ${localDate(new Date(r.past_due_since))}; site auto-pauses ${pauseOn} unless paid` : '';
    return `${who} [${r.status}${sub}${next}]${failed}${dunning}`;
  });
  return `Card subscriptions (Stripe charges these automatically each month; each charge books itself as a paid invoice): ${parts.join('; ')}.`;
}
