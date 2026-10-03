import type { APIRoute } from 'astro';
import { stripeConfigured } from '../../../../lib/clearear/stripe';
import { startSubscriptionCheckout, SignupError } from '../../../../lib/janet/clearear/subscriptions';

// Client clicks "Set up automatic payments" on /subscribe/[token]. The amount and the first
// charge date come from the retainer server-side (never the browser), and Stripe hosts the
// card form — no card data touches BLVSTACK.
export const prerender = false;

export const POST: APIRoute = async ({ params, url }) => {
  if (!stripeConfigured()) return json({ error: 'Payments not configured.' }, 503);
  try {
    const checkoutUrl = await startSubscriptionCheckout(params.token as string, url.origin);
    return json({ ok: true, url: checkoutUrl });
  } catch (e) {
    if (e instanceof SignupError) return json({ error: e.message }, e.status);
    console.error('[subscribe checkout]', (e as Error)?.message);
    return json({ error: 'Could not open checkout — please try again.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
