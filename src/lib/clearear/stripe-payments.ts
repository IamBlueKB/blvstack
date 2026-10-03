import { supabaseAdmin } from '../supabase';
import { stripe } from './stripe';
import { recomputeInvoice } from '../janet/clearear/invoicing';

// Posting a succeeded Stripe payment to a BLV invoice — shared by the one-off invoice checkout (the Pay button) and
// the monthly card subscriptions, so both go through exactly the same money path:
//   the payment at its GROSS, the processing fee as a system-generated 'fees' expense (gross ≠ net), the invoice
//   recomputed. Idempotent on the PaymentIntent, so Stripe's at-least-once retries can't double-post.

const isoOf = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : new Date().toISOString());
const dateOf = (unix: number | null | undefined) => isoOf(unix).slice(0, 10);

export async function recordStripePayment(opts: { invoiceId: string; piId: string; amountCents: number; paidAtUnix: number | null }) {
  const { invoiceId, piId, amountCents, paidAtUnix } = opts;
  const s = stripe();

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
    .from('clearear_invoices').select('id, contact_id, invoice_number, business').eq('id', invoiceId).maybeSingle();
  if (!inv) throw new Error(`Invoice ${invoiceId} not found for PI ${piId}`);

  // Dedup is the UNIQUE stripe_payment_intent_id (checked above + DB constraint);
  // clearear_payments has no idempotency_key column. Throw on error so a failed
  // insert is never silently 200'd.
  const { error: payErr } = await supabaseAdmin.from('clearear_payments').insert({
    business: inv.business, invoice_id: inv.id, contact_id: inv.contact_id,
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
      business: inv.business, spent_at: paidAt, vendor: 'Stripe', amount: fee, category_key: 'fees', method: 'stripe',
      reference: piId, notes: `Processing fee · ${inv.invoice_number}`,
      deductible: true, deductible_pct: cat?.deductible_pct ?? 100,
      system_generated: true, idempotency_key: `stripe_fee:${piId}`, created_by: 'stripe',
    });
  }

  await recomputeInvoice(inv.id);
}
