import type { APIRoute } from 'astro';
import { generateBriefing, runScheduledScans } from '../../../lib/janet/heartbeat';

export const prerender = false;
export const maxDuration = 300;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-heartbeat — Vercel Cron, daily (spec §8).
 * Scans connected sites (fresh regression data), then generates + stores
 * today's briefing. One cron does both to stay within the cron budget. Auth:
 * Bearer CRON_SECRET (Vercel injects it on cron calls); also runnable manually.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const scans = await runScheduledScans();
    const content = await generateBriefing();
    return j({
      ok: true,
      scanned: scans.length,
      summary: content.summary,
      counts: { needs_attention: content.needs_attention.length, suggestions: content.suggestions.length, fyi: content.fyi.length },
    });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'heartbeat failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
