import type { APIRoute } from 'astro';
import { runReconcile } from '../../../lib/janet/dream/reconcile';
import { runConsolidate } from '../../../lib/janet/dream/consolidate';
import { runSynthesize } from '../../../lib/janet/dream/synthesize';
import { beginDreamBudget } from '../../../lib/janet/dream/model';
import { assembleJournal, persistDreamRun, journalHeadline } from '../../../lib/janet/dream/brief';
import { JANET_DREAM_MAX_COST } from '../../../lib/janet/config';

export const prerender = false;
export const maxDuration = 300; // two 1-request batches, polled with a ~2min cap each

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-dream — the nightly dreaming cron (the Dreaming Phase).
 * Runs, in order, on the dream's OWN budget cap:
 *   1. reconcile  (deterministic — closes dead recs, stages resolved predictions)
 *   2. consolidate (Batch model — memory hygiene proposals; exact-dup merges auto-apply)
 *   3. synthesize  (Batch model — reasoning-pattern / graveyard / strategy candidates)
 *   4. journal     (deterministic — the honest record the morning brief folds in)
 *
 * Scheduled overnight so the morning heartbeat's brief can pull the journal in.
 * Ring 1/2 only — nothing here reaches a person; every proposal waits for Blue.
 * Auth: Bearer CRON_SECRET (Vercel injects it); also runnable manually.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }

  try {
    beginDreamBudget(JANET_DREAM_MAX_COST);
    const dream_run_at = new Date().toISOString(); // one stamp shared by both model jobs

    // 1. Reconcile — always completes (no model).
    const reconcile = await runReconcile();

    // 2 + 3. Consolidate then Synthesize — each may come back 'incomplete' if its
    // batch didn't finish in the window or the budget ran out. They never throw
    // here (they self-report status); the journal renders that honestly.
    const consolidate = await runConsolidate(dream_run_at);
    const synthesize = await runSynthesize(dream_run_at);

    // 4. Journal — the honest, deterministic record; persisted for the morning brief.
    const journal = await persistDreamRun(assembleJournal(reconcile, consolidate, synthesize));

    return j({
      ok: true,
      dream_run_at,
      status: journal.status,
      headline: journalHeadline(journal),
      journal,
    });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'dream cron failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
