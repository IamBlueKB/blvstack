import type { APIRoute } from 'astro';
import { generateDueRecurring } from '../../../lib/janet/clearear/recurring';
import { flipOverdue } from '../../../lib/janet/clearear/chasing';

export const prerender = false;
export const maxDuration = 120;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/** GET /api/cron/clearear-recurring — daily. (1) Flips past-due invoices with a
 *  balance to 'overdue', then (2) generates the next DRAFT invoice for every
 *  recurring template whose date has arrived and advances the schedule. Never
 *  sends — Blue reviews and sends; overdue reminders queue as prepared decisions
 *  in the morning queue. Auth: Bearer CRON_SECRET. */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const overdue = await flipOverdue();
    const r = await generateDueRecurring();
    return j({ ok: true, overdue_flipped: overdue.flipped, ...r });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'clearear daily job failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
