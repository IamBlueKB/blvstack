import type { APIRoute } from 'astro';
import { generatePsrxBrief } from '../../../lib/janet/psrx/brief';
import { supabaseAdmin } from '../../../lib/supabase';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../../lib/resend';

export const prerender = false;
export const maxDuration = 300;

const CRON_SECRET = import.meta.env.CRON_SECRET;
// Soft monthly spend watch on the (Opus) weekly brief — an ALERT, not a breaker.
// The brief runs weekly; if trailing-30d brief spend crosses this, email Blue.
const BRIEF_MONTHLY_ALERT_USD = Number(import.meta.env.JANET_BRIEF_MONTHLY_ALERT_USD ?? 15);

/** Best-effort: alert (don't block) if the last 30 days of brief spend is high. */
async function briefSpendWatch(): Promise<void> {
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data } = await supabaseAdmin.from('janet_client_briefs').select('cost_usd').gte('created_at', since);
    const total = (data ?? []).reduce((s, r: any) => s + (Number(r.cost_usd) || 0), 0);
    if (total > BRIEF_MONTHLY_ALERT_USD) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: FOUNDER_EMAIL,
        subject: `JANET brief spend watch: $${total.toFixed(2)} in the last 30 days`,
        text: `Trailing-30-day weekly-brief spend is $${total.toFixed(2)}, over the $${BRIEF_MONTHLY_ALERT_USD} alert threshold. Not a hard limit — just a heads-up to check the cadence/model.`,
      });
    }
  } catch (e) {
    console.error('[cron/brief] spend watch failed:', (e as Error).message);
  }
}

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
    await briefSpendWatch();
    return j({ ok: true, summary: r.brief.summary, opportunities_logged: r.opportunities_logged, cost_usd: r.cost_usd });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'brief failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
