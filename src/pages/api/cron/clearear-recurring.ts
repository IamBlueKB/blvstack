import type { APIRoute } from 'astro';
import { generateDueRecurring } from '../../../lib/janet/clearear/recurring';

export const prerender = false;
export const maxDuration = 120;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/** GET /api/cron/clearear-recurring — daily. Generates the next DRAFT invoice for
 *  every recurring template whose date has arrived, and advances the schedule.
 *  Never sends — Blue reviews and sends. Auth: Bearer CRON_SECRET. */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const r = await generateDueRecurring();
    return j({ ok: true, ...r });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'recurring generation failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
