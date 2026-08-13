import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { stripe, stripeConfigured } from '../../../lib/clearear/stripe';
import { recomputeInvoice } from '../../../lib/janet/clearear/invoicing';

// Stripe webhook — the ONLY place a Stripe payment ever posts (base spec §4.5).
// Signature is verified before anything is trusted. Idempotent on payment_intent /
// refund id so Stripe's at-least-once retries can't double-post.
//
// Events handled:
//   checkout.session.completed  → record a payment for the invoice + a fees expense
//                                 for the processing fee (gross ≠ net; A5-safe).
//   charge.refunded             → refund as its own NEGATIVE payment row (A5), never
//                                 an edit. Fee stays as an expense (Stripe keeps it).
//   charge.dispute.funds_withdrawn → negative payment + dispute fee expense (A6).
//   charge.dispute.funds_reinstated → reversing positive payment (dispute fee stays lost).
//   charge.dispute.created      → flag only (money moves on funds_withdrawn).
export const prerender = false;
export const maxDuration = 30;

const WHSEC = (import.meta as any).env?.STRIPE_WEBHOOK_SECRET as string | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const isoOf = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toISOString() : new Date().toISOString();
const dateOf = (unix: number | null | undefined) => isoOf(unix).slice(0, 10);

export const POST: APIRoute = async ({ request }) => {
  if (!stripeConfigured() || !WHSEC) return json({ error: 'Stripe not configured' }, 503);
  const sig = request.headers.get('stripe-signature') || '';
  const raw = await request.text();

  let ev: import('stripe').Stripe.Event;
  try {
    ev = stripe().webhooks.constructEvent(raw, sig, WHSEC);
  } catch (e: any) {
    // Unsigned / forged → 400, log nothing (untrusted input).
    return json({ error: `Bad signature: ${e?.message ?? ''}` }, 400);
  }

  try {
    switch (ev.type) {
      case 'checkout.session.completed':
      case 'payment_intent.succeeded':
        await handlePaid(ev);
        break;
      case 'charge.refunded':
        await handleRefunded(ev);
        break;
      case 'charge.dispute.created':
        await flagDispute(ev, 'created');
        break;
      case 'charge.dispute.funds_withdrawn':
        await handleDisputeFundsWithdrawn(ev);
        break;
      case 'charge.dispute.funds_reinstated':
        await handleDisputeFundsReinstated(ev);
        break;
      default:
        // Unhandled — still 200 so Stripe doesn't retry.
        return json({ ok: true, ignored: ev.type });
    }
    return json({ ok: true });
  } catch (e: any) {
    console.error('[stripe webhook]', ev.type, e?.message);
    // 500 → Stripe retries. We stay idempotent on retries.
    return json({ error: e?.message ?? 'handler failed' }, 500);
  }
};

// ── Handlers ─────────────────────────────────────────────────────────────

async function handlePaid(ev: import('stripe').Stripe.Event) {
  const s = stripe();
  let piId: string | null = null;
  let invoiceId: string | null = null;
  let amountCents = 0, paidAtUnix: number | null = null;

  if (ev.type === 'checkout.session.completed') {
    const sess = ev.data.object as import('stripe').Stripe.Checkout.Session;
    if (sess.payment_status !== 'paid') return;
    piId = typeof sess.payment_intent === 'string' ? sess.payment_intent : sess.payment_intent?.id ?? null;
    invoiceId = (sess.metadata?.invoice_id as string) || (sess.client_reference_id as string) || null;
    amountCents = sess.amount_total ?? 0;
    paidAtUnix = (sess.created as number | null) ?? null;
  } else {
    const pi = ev.data.object as import('stripe').Stripe.PaymentIntent;
    piId = pi.id;
    invoiceId = (pi.metadata?.invoice_id as string) || null;
    amountCents = pi.amount_received ?? pi.amount ?? 0;
    paidAtUnix = pi.created ?? null;
  }
  if (!piId || !invoiceId || amountCents <= 0) return;

  // A. Idempotent by payment_intent — never double-post on Stripe retries.
  const { data: exists } = await supabaseAdmin
    .from('clearear_payments').select('id').eq('stripe_payment_intent_id', piId).maybeSingle();
  if (exists) return;

  // B. Fee/net from the balance transaction. Stripe attaches it to the charge a beat
  //    AFTER payment_intent.succeeded fires, so poll briefly; if it still isn't there,
  //    THROW → Stripe retries the whole webhook (idempotent) rather than record a
  //    wrong gross==net with no fee. Payment is inserted only once fee/net are known.
  const piFull = await s.paymentIntents.retrieve(piId);
  const chargeId = typeof piFull.latest_charge === 'string' ? piFull.latest_charge : (piFull.latest_charge as any)?.id ?? null;
  if (!chargeId) throw new Error(`No charge on PI ${piId} yet — retry`);
  let feeCents: number | null = null, netCents = amountCents;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ch = await s.charges.retrieve(chargeId);
    const btId = typeof ch.balance_transaction === 'string' ? ch.balance_transaction : (ch.balance_transaction as any)?.id ?? null;
    if (btId) {
      const bt = await s.balanceTransactions.retrieve(btId);
      feeCents = bt.fee ?? 0;
      netCents = bt.net ?? (amountCents - (bt.fee ?? 0));
      break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (feeCents === null) throw new Error(`Balance transaction not ready for charge ${chargeId} — Stripe will retry`);

  const gross = amountCents / 100, fee = feeCents / 100, net = netCents / 100;
  const paidAt = dateOf(paidAtUnix);

  // C. Look up invoice + contact for the payment row.
  const { data: inv } = await supabaseAdmin
    .from('clearear_invoices').select('id, contact_id, invoice_number').eq('id', invoiceId).maybeSingle();
  if (!inv) throw new Error(`Invoice ${invoiceId} not found for PI ${piId}`);

  // Dedup is the UNIQUE stripe_payment_intent_id (checked above + DB constraint);
  // clearear_payments has no idempotency_key column. Throw on error so a failed
  // insert is never silently 200'd.
  const { error: payErr } = await supabaseAdmin.from('clearear_payments').insert({
    invoice_id: inv.id, contact_id: inv.contact_id,
    amount: gross, method: 'stripe', paid_at: paidAt,
    reference: piId, is_deposit: false, notes: `Stripe · ${inv.invoice_number}`,
    recorded_by: 'stripe',
    stripe_payment_intent_id: piId, fee_amount: fee, net_amount: net,
  });
  if (payErr && !/duplicate key/i.test(payErr.message)) throw new Error(`payment insert: ${payErr.message}`);

  // D. Book the processing fee as a system-generated 'fees' expense so gross funds
  // the invoice and net reflects what actually deposited.
  if (fee > 0) {
    const { data: cat } = await supabaseAdmin.from('clearear_expense_categories').select('deductible_pct').eq('key', 'fees').maybeSingle();
    await supabaseAdmin.from('clearear_expenses').insert({
      spent_at: paidAt, vendor: 'Stripe', amount: fee, category_key: 'fees', method: 'stripe',
      reference: piId, notes: `Processing fee · ${inv.invoice_number}`,
      deductible: true, deductible_pct: cat?.deductible_pct ?? 100,
      system_generated: true, idempotency_key: `stripe_fee:${piId}`, created_by: 'stripe',
    });
  }

  await recomputeInvoice(inv.id);
}

async function handleRefunded(ev: import('stripe').Stripe.Event) {
  const charge = ev.data.object as import('stripe').Stripe.Charge;
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
  if (!piId) return;
  const { data: original } = await supabaseAdmin
    .from('clearear_payments').select('id, invoice_id, contact_id').eq('stripe_payment_intent_id', piId).maybeSingle();
  if (!original) return; // never posted → nothing to refund on our side

  const refunds = charge.refunds?.data ?? [];
  for (const r of refunds) {
    if (r.status !== 'succeeded') continue;
    const { data: dupe } = await supabaseAdmin.from('clearear_payments').select('id').eq('stripe_refund_id', r.id).maybeSingle();
    if (dupe) continue;
    const { error } = await supabaseAdmin.from('clearear_payments').insert({
      invoice_id: original.invoice_id, contact_id: original.contact_id,
      amount: -(r.amount / 100), method: 'stripe', paid_at: dateOf(r.created),
      reference: r.id, notes: 'Stripe refund', recorded_by: 'stripe',
      stripe_refund_id: r.id, refund_of_payment_id: original.id,
    });
    if (error && !/duplicate key/i.test(error.message)) throw new Error(`refund insert: ${error.message}`);
  }
  if (original.invoice_id) await recomputeInvoice(original.invoice_id);
}

async function flagDispute(ev: import('stripe').Stripe.Event, phase: 'created') {
  const d = ev.data.object as import('stripe').Stripe.Dispute;
  const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
  if (!piId) return;
  const { data: pay } = await supabaseAdmin.from('clearear_payments').select('id, invoice_id').eq('stripe_payment_intent_id', piId).maybeSingle();
  if (!pay?.invoice_id) return;
  const { data: inv } = await supabaseAdmin.from('clearear_invoices').select('notes').eq('id', pay.invoice_id).maybeSingle();
  const flag = `⚠ Stripe DISPUTE ${phase} ${new Date().toISOString().slice(0, 10)} · ${d.reason ?? ''}`;
  const notes = inv?.notes && !inv.notes.includes(flag) ? `${flag}\n${inv.notes}` : (inv?.notes ?? flag);
  await supabaseAdmin.from('clearear_invoices').update({ notes, updated_at: new Date().toISOString() }).eq('id', pay.invoice_id);
}

async function handleDisputeFundsWithdrawn(ev: import('stripe').Stripe.Event) {
  const d = ev.data.object as import('stripe').Stripe.Dispute;
  const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
  if (!piId) return;
  const { data: original } = await supabaseAdmin.from('clearear_payments').select('id, invoice_id, contact_id').eq('stripe_payment_intent_id', piId).maybeSingle();
  if (!original) return;

  // 1) Negative payment for the disputed amount. Dedup on (dispute id + negative
  //    sign) since clearear_payments has no idempotency_key column.
  const { data: dupe } = await supabaseAdmin.from('clearear_payments').select('id').eq('reference', d.id).lt('amount', 0).maybeSingle();
  if (!dupe) {
    await supabaseAdmin.from('clearear_payments').insert({
      invoice_id: original.invoice_id, contact_id: original.contact_id,
      amount: -(d.amount / 100), method: 'stripe', paid_at: new Date().toISOString().slice(0, 10),
      reference: d.id, notes: `Stripe dispute funds withdrawn · ${d.reason ?? ''}`,
      recorded_by: 'stripe', refund_of_payment_id: original.id,
    });
  }

  // 2) Dispute fee posts as a system-generated fees expense (A6).
  const feeCents = d.balance_transactions?.[0]?.fee ?? d.balance_transactions?.[0]?.amount ?? 0;
  const fee = Math.abs(feeCents) / 100;
  if (fee > 0) {
    const feeKey = `stripe_dispute_fee:${d.id}`;
    const { data: fdupe } = await supabaseAdmin.from('clearear_expenses').select('id').eq('idempotency_key', feeKey).maybeSingle();
    if (!fdupe) {
      const { data: cat } = await supabaseAdmin.from('clearear_expense_categories').select('deductible_pct').eq('key', 'fees').maybeSingle();
      await supabaseAdmin.from('clearear_expenses').insert({
        spent_at: new Date().toISOString().slice(0, 10), vendor: 'Stripe', amount: fee, category_key: 'fees', method: 'stripe',
        reference: d.id, notes: 'Dispute fee',
        deductible: true, deductible_pct: cat?.deductible_pct ?? 100,
        system_generated: true, idempotency_key: feeKey, created_by: 'stripe',
      });
    }
  }
  await flagDispute(ev, 'created');
  if (original.invoice_id) await recomputeInvoice(original.invoice_id);
}

async function handleDisputeFundsReinstated(ev: import('stripe').Stripe.Event) {
  const d = ev.data.object as import('stripe').Stripe.Dispute;
  const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
  if (!piId) return;
  const { data: original } = await supabaseAdmin.from('clearear_payments').select('id, invoice_id, contact_id').eq('stripe_payment_intent_id', piId).maybeSingle();
  if (!original) return;
  // Dedup on (dispute id + positive sign) — distinct from the withdrawal's negative row.
  const { data: dupe } = await supabaseAdmin.from('clearear_payments').select('id').eq('reference', d.id).gt('amount', 0).maybeSingle();
  if (dupe) return;
  await supabaseAdmin.from('clearear_payments').insert({
    invoice_id: original.invoice_id, contact_id: original.contact_id,
    amount: d.amount / 100, method: 'stripe', paid_at: new Date().toISOString().slice(0, 10),
    reference: d.id, notes: `Stripe dispute funds reinstated · ${d.reason ?? ''}`,
    recorded_by: 'stripe',
  });
  if (original.invoice_id) await recomputeInvoice(original.invoice_id);
}
