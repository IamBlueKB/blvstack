import type { APIRoute } from 'astro';
import { runPsrxDailyCycle } from '../../../lib/janet/psrx/nurture';

export const prerender = false;
export const maxDuration = 300;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-psrx-followups — Vercel Cron, DAILY.
 * The daily half of the re-engagement cycle: reconcile outcomes (the learning
 * signal), then release due-dated follow-ups into the approval queue (drafting
 * fresh) the day they come due — speed is the edge. The weekly cold-lead sweep
 * lives in /api/cron/janet-psrx-sweep. She never sends — the clinic manager
 * approves. Auth: Bearer CRON_SECRET. Degrades cleanly if PSRx isn't connected.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const r = await runPsrxDailyCycle();
    return j({ ok: true, ...r });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'daily cycle failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
