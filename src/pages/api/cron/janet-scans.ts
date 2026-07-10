import type { APIRoute } from 'astro';
import { runScheduledScans } from '../../../lib/janet/heartbeat';

export const prerender = false;
export const maxDuration = 300;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-scans — on-demand Build Standard scan of every active
 * connected site (spec §7.2). Not on a separate schedule — the daily heartbeat
 * runs scans inline (one cron budget). Kept for manual/ad-hoc runs. Auth:
 * Bearer CRON_SECRET.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const results = await runScheduledScans();
    return j({ ok: true, scanned: results.length, results });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'scan failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
