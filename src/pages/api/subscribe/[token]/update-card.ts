import type { APIRoute } from 'astro';
import { stripeConfigured } from '../../../../lib/clearear/stripe';
import { startCardUpdate, SignupError } from '../../../../lib/janet/clearear/subscriptions';

// Client clicks "Update card" on their billing page (/subscribe/[token]). Stripe hosts the card form (setup mode);
// the webhook makes the new card the one on file and retries any unpaid invoice right away.
export const prerender = false;

export const POST: APIRoute = async ({ params, url }) => {
  if (!stripeConfigured()) return json({ error: 'Payments not configured.' }, 503);
  try {
    const formUrl = await startCardUpdate(params.token as string, url.origin);
    return json({ ok: true, url: formUrl });
  } catch (e) {
    if (e instanceof SignupError) return json({ error: e.message }, e.status);
    console.error('[subscribe update-card]', (e as Error)?.message);
    return json({ error: 'Could not open the card form — please try again.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
