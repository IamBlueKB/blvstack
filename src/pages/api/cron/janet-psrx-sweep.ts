import type { APIRoute } from 'astro';
import { runPsrxWeeklySweep } from '../../../lib/janet/psrx/nurture';

export const prerender = false;
export const maxDuration = 300;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-psrx-sweep — Vercel Cron, WEEKLY.
 * The weekly half of the re-engagement cycle: sweep newly-cold leads into the
 * re-engagement schedule (triage + schedule/decline). The daily release +
 * reconcile lives in /api/cron/janet-psrx-followups. She never sends.
 * Auth: Bearer CRON_SECRET. Degrades cleanly if PSRx isn't connected.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const r = await runPsrxWeeklySweep();
    return j({ ok: true, ...r });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'weekly sweep failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
