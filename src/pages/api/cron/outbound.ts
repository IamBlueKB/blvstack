import type { APIRoute } from 'astro';
import { runSendBatch, runFollowUps } from '../../../lib/outbound/engine';

export const prerender = false;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/outbound
 * Called by Vercel Cron every 6 hours.
 * Sends queued emails and processes follow-ups.
 * Reply detection is handled by webhooks (not cron).
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return j({ error: 'Unauthorized' }, 401);
    }
  }

  const results: Record<string, unknown> = {};

  try {
    results.send = await runSendBatch();
  } catch (err: any) {
    results.send = { error: err?.message };
  }

  try {
    results.followups = await runFollowUps();
  } catch (err: any) {
    results.followups = { error: err?.message };
  }

  return j({ ok: true, ran_at: new Date().toISOString(), results });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
