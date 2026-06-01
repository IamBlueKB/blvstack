import type { APIRoute } from 'astro';
import { runVenueFollowUps } from '../../../lib/booker/engine';

export const prerender = false;

// Accept either BOOKER_CRON_SECRET (preferred — manual / external) or
// CRON_SECRET (Vercel auto-injects this on cron calls; one secret for all crons).
const BOOKER_CRON_SECRET = import.meta.env.BOOKER_CRON_SECRET;
const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/booker
 * Vercel Cron entrypoint for BLVBooker.
 * Currently runs venue follow-ups (Build B sequence).
 */
export const GET: APIRoute = async ({ request }) => {
  const auth = request.headers.get('authorization');
  const validSecrets = [BOOKER_CRON_SECRET, CRON_SECRET].filter(Boolean) as string[];

  if (validSecrets.length > 0) {
    const ok = validSecrets.some((s) => auth === `Bearer ${s}`);
    if (!ok) {
      return j({ error: 'Unauthorized' }, 401);
    }
  }

  const results: Record<string, unknown> = {};

  try {
    results.venue_followups = await runVenueFollowUps();
  } catch (err: any) {
    results.venue_followups = { error: err?.message };
  }

  return j({ ok: true, ran_at: new Date().toISOString(), results });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
