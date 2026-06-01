import type { APIRoute } from 'astro';
import { runVenueFollowUps } from '../../../lib/booker/engine';

export const prerender = false;

const BOOKER_CRON_SECRET = import.meta.env.BOOKER_CRON_SECRET;

/**
 * GET /api/cron/booker
 * Vercel Cron entrypoint for BLVBooker. Own secret, own cadence.
 * Currently runs venue follow-ups (Build B sequence).
 */
export const GET: APIRoute = async ({ request }) => {
  if (BOOKER_CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${BOOKER_CRON_SECRET}`) {
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
