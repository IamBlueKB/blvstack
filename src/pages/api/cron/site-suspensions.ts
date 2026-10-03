import type { APIRoute } from 'astro';
import { runDunningSweep } from '../../../lib/janet/clearear/dunning';

export const prerender = false;
export const maxDuration = 120;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/** GET /api/cron/site-suspensions — hourly. Moves every past-due card subscription along Blue's non-payment policy:
 *  reminder 2 days before the pause date, then pause the linked site(s) (BLVSTACK holding page) and tell the client;
 *  restores any paused site whose payment went through while a webhook was missed. Payments themselves restore sites
 *  instantly via the Stripe webhook — this is the clock, not the trigger. Auth: Bearer CRON_SECRET. */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const r = await runDunningSweep();
    if (r.errors.length) console.error('[cron site-suspensions]', r.errors);
    return j({ ok: true, ...r });
  } catch (e) {
    console.error('[cron site-suspensions]', (e as Error).message);
    return j({ error: (e as Error).message }, 500);
  }
};

const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
