import type { APIRoute } from 'astro';
import { countUnassessedLeads, generateBriefing } from '../../../lib/janet/heartbeat';

export const prerender = false;
export const maxDuration = 120;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-leads — hourly lightweight lead check (proactive lead
 * handling). NO site scans. Cheap when nothing is new: just a head-count query,
 * zero Claude. When un-assessed leads exist, it regenerates the briefing —
 * which detects + auto-triages them and briefs them into Needs Attention, and
 * marks the briefing unread so the orb alerts Blue within the hour instead of
 * waiting for the daily heartbeat. Auth: Bearer CRON_SECRET.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }
  try {
    const pending = await countUnassessedLeads();
    if (pending === 0) return j({ ok: true, new_leads: 0, briefed: false });
    const content = await generateBriefing();
    return j({ ok: true, new_leads: pending, briefed: true, summary: content.summary });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'lead check failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
