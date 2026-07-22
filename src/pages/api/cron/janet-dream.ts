import type { APIRoute } from 'astro';
import { runReconcile } from '../../../lib/janet/dream/reconcile';
import { prepareConsolidate } from '../../../lib/janet/dream/consolidate';
import { prepareSynthesize } from '../../../lib/janet/dream/synthesize';
import { beginDreamBudget } from '../../../lib/janet/dream/model';
import { insertSubmittedRun, hasRecentActiveRun } from '../../../lib/janet/dream/brief';
import { JANET_DREAM_MAX_COST } from '../../../lib/janet/config';

export const prerender = false;
export const maxDuration = 60; // submit only — no polling; reconcile + two batch-create calls

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-dream — the NIGHT (submit) half of the two-phase dream.
 *   1. reconcile      (deterministic — inline, stays in the night pass)
 *   2. prepareConsolidate  — exact-dup merges (auto-applied) + SUBMIT its batch (first, unconditional)
 *   3. prepareSynthesize   — SUBMIT its batch ONLY if the projected cost fits under
 *                            the dream cap; a breach records the run partial without spending
 *   4. persist the 'submitted' run (batch ids + provenance snapshot) and EXIT — no polling
 *
 * The collector (/api/cron/janet-dream-collect) retrieves the results later and
 * writes the journal. Per-day idempotent: a second same-night hit is refused.
 * Auth: Bearer CRON_SECRET. Ring 1/2 only — nothing here reaches a person.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }

  try {
    const dream_run_at = new Date().toISOString();

    // Per-day idempotency: don't open a second set of batches the same night.
    if (await hasRecentActiveRun(dream_run_at)) {
      return j({ ok: true, phase: 'skipped', reason: 'a dream run was already submitted in the last 20h' });
    }

    const cap = JANET_DREAM_MAX_COST > 0 ? JANET_DREAM_MAX_COST : null;
    beginDreamBudget(JANET_DREAM_MAX_COST);

    // 1. Reconcile — inline, deterministic, always completes (no model).
    const reconcile = await runReconcile();
    const reconcileFacts = { flagged: reconcile.recs.flagged, closed: reconcile.recs.closed, staged: reconcile.predictions.staged };

    // 2. Consolidate submits FIRST (unconditional).
    const consolidate = await prepareConsolidate(dream_run_at);
    // 3. Synthesize submits SECOND, cap-gated (see submitDreamBatchGated).
    const synthesize = await prepareSynthesize(dream_run_at);

    // 4. Persist the submitted run and exit.
    await insertSubmittedRun({ dream_run_at, submitted_at: dream_run_at, reconcile: reconcileFacts, consolidate, synthesize, cap });

    return j({
      ok: true,
      phase: 'submitted',
      dream_run_at,
      reconcile: reconcileFacts,
      consolidate: { status: consolidate.status, batch_id: consolidate.batch_id ?? null, auto_merged: consolidate.auto_merged },
      synthesize: { status: synthesize.status, batch_id: synthesize.batch_id ?? null, ...(synthesize.cap_breach ? { cap_breach: true, note: synthesize.note } : {}) },
    });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'dream submit cron failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
