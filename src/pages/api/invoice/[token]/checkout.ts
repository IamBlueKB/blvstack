import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { stripe, stripeConfigured } from '../../../../lib/clearear/stripe';
import { invoiceIdForToken, getInvoice } from '../../../../lib/janet/clearear/invoicing';

// Client clicks Pay on /invoice/[token]. We resolve the invoice server-side, use
// its CURRENT balance (never trust an amount from the browser), and create a
// Stripe Checkout Session hosted by Stripe (no card data touches BLVSTACK).
export const prerender = false;

export const POST: APIRoute = async ({ params, url }) => {
  if (!stripeConfigured()) return json({ error: 'Payments not configured.' }, 503);
  const token = params.token as string;
  const invoiceId = await invoiceIdForToken(token);
  if (!invoiceId) return json({ error: 'Invoice not found.' }, 404);
  const data = await getInvoice(invoiceId);
  if (!data) return json({ error: 'Invoice not found.' }, 404);
  const { invoice, contact } = data as any;
  if (invoice.status === 'void') return json({ error: 'This invoice is void.' }, 400);
  if (invoice.status === 'paid' || Number(invoice.balance) <= 0) return json({ error: 'This invoice is already paid.' }, 400);

  const cents = Math.round(Number(invoice.balance) * 100);
  if (!(cents > 0)) return json({ error: 'Nothing to charge.' }, 400);

  // Per-business statement descriptor. One Stripe account, two brands. Stripe no longer
  // allows overriding the FULL descriptor on card charges — only a per-charge SUFFIX
  // that appends to the account's fixed prefix, so the cardholder sees "PREFIX* SUFFIX".
  // The suffix carries the brand. (letters/numbers/spaces only, no < > \ ' " *)
  const statementDescriptorSuffix = invoice.business === 'blvstack' ? 'Blvstack' : 'Clear Ear';

  const back = `${url.origin}/invoice/${token}`;
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Invoice ${invoice.invoice_number}${invoice.notes ? '' : ''}` },
        unit_amount: cents,
      },
      quantity: 1,
    }],
    customer_email: contact?.email ?? undefined,
    client_reference_id: invoiceId,
    metadata: { invoice_id: invoiceId, invoice_number: invoice.invoice_number, contact_id: invoice.contact_id ?? '' },
    payment_intent_data: {
      statement_descriptor_suffix: statementDescriptorSuffix,
      // These land on the PaymentIntent too so the webhook has them regardless of session lookup.
      metadata: { invoice_id: invoiceId, invoice_number: invoice.invoice_number, contact_id: invoice.contact_id ?? '' },
    },
    success_url: `${back}?stripe=processing`,
    cancel_url: back,
  });

  return json({ ok: true, url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
