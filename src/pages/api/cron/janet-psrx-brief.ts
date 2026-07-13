import type { APIRoute } from 'astro';
import { generatePsrxBrief } from '../../../lib/janet/psrx/brief';

export const prerender = false;
export const maxDuration = 300;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-psrx-brief — Vercel Cron, weekly (Phase 4D).
 * Composes + stores the PSRx weekly intelligence brief (heavy model + web search)
 * and logs its opportunities to the ledger. Auth: Bearer CRON_SECRET. Degrades
 * cleanly if PSRx isn't connected (generate throws → 500, no partial writes).
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const r = await generatePsrxBrief();
    return j({ ok: true, summary: r.brief.summary, opportunities_logged: r.opportunities_logged, cost_usd: r.cost_usd });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'brief failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
