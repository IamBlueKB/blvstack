import type { APIRoute } from 'astro';
import { runInvariants } from '../../../lib/janet/invariants';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../../lib/resend';

export const prerender = false;
export const maxDuration = 60;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/invariants — scheduled invariants probe (Phase 4.2).
 * Runs every check; if ANY hard-fails, emails Blue so source≠live drift is
 * caught by machine, not by hand. Returns 500 on failure so the Vercel Cron
 * dashboard also flags the run.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return json({ error: 'Unauthorized' }, 401);
  }

  const result = await runInvariants();

  if (!result.ok) {
    const failed = result.checks.filter((c) => c.ok === false);
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: FOUNDER_EMAIL,
        subject: `⚠ JANET invariants FAILED (${failed.length})`,
        text:
          `The scheduled invariants probe found ${failed.length} failing check(s) at ${result.ran_at}:\n\n` +
          failed.map((c) => `✗ ${c.name}: ${c.detail}`).join('\n') +
          `\n\nFull result:\n${JSON.stringify(result, null, 2)}`,
      });
    } catch (e) {
      console.error('[cron/invariants] alert email failed:', (e as Error).message);
    }
  }

  return json(result, result.ok ? 200 : 500);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
