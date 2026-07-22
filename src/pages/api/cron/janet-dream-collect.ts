import type { APIRoute } from 'astro';
import { beginDreamBudget, dreamSpent, collectDreamBatch, parseDreamJson, type CollectResult } from '../../../lib/janet/dream/model';
import { finalizeConsolidate, type ConsolidatePending } from '../../../lib/janet/dream/consolidate';
import { finalizeSynthesize, type SynthesizePending } from '../../../lib/janet/dream/synthesize';
import { getSubmittedRuns, finalizeDreamRun } from '../../../lib/janet/dream/brief';
import { assembleJournal, nextCollectState, DREAM_EXPIRY_HOURS, type BatchLeg, type ConsolidateFacts, type SynthesizeFacts } from '../../../lib/janet/dream/pure';
import { JANET_DREAM_MAX_COST } from '../../../lib/janet/config';

export const prerender = false;
export const maxDuration = 120;

const CRON_SECRET = import.meta.env.CRON_SECRET;

/**
 * GET /api/cron/janet-dream-collect — the COLLECTOR half of the two-phase dream.
 * For each 'submitted' run: retrieve its batches; if both have ENDED, finalize the
 * journal and mark 'collected'; if a batch ended with a non-succeeded result,
 * 'failed'; if >24h and a batch never ended, 'expired'; otherwise leave 'submitted'
 * (the morning brief renders it "in flight"). Idempotent — only touches 'submitted'
 * rows, proposal writes are keyed, and the journal write upserts on dream_run_at.
 */
export const GET: APIRoute = async ({ request }) => {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) return j({ error: 'Unauthorized' }, 401);
  }

  try {
    const runs = await getSubmittedRuns();
    const results = [];
    for (const run of runs) {
      try {
        results.push(await collectRun(run));
      } catch (e: any) {
        results.push({ dream_run_at: run.dream_run_at, error: e?.message ?? 'collect failed' });
      }
    }
    return j({ ok: true, considered: runs.length, results });
  } catch (err: any) {
    return j({ ok: false, error: err?.message ?? 'dream collect cron failed' }, 500);
  }
};

async function collectRun(run: any): Promise<Record<string, unknown>> {
  const consP: ConsolidatePending = run.pending?.consolidate ?? { status: 'skipped_no_input', live_memory_ids: [], digest_ids: [], auto_merged: 0, proposal_ids: [], memories_scanned: 0 };
  const synP: SynthesizePending = run.pending?.synthesize ?? { status: 'skipped_no_input', rec_ids: [], pred_ids: [], pat_ids: [], inputs: { resolved_recs: 0, scored_predictions: 0, patterns: 0 }, since: '' };
  const cap = typeof run.budget?.cap === 'number' ? run.budget.cap : JANET_DREAM_MAX_COST > 0 ? JANET_DREAM_MAX_COST : null;
  const hoursSince = (Date.now() - new Date(run.submitted_at ?? run.dream_run_at).getTime()) / 3_600_000;

  // Realized-cost budget MUST start before any collectDreamBatch, which accrues to it.
  beginDreamBudget(cap ?? 0);

  // Retrieve each leg. A job with no batch (skipped_no_input / cap-breach) is
  // "ended, no work" — it never had a batch to wait on.
  let consCollect: CollectResult | null = null;
  let synCollect: CollectResult | null = null;
  const consLeg: BatchLeg = run.consolidate_batch_id
    ? ((consCollect = await collectDreamBatch(run.consolidate_batch_id)), { ended: consCollect.status !== 'pending', errored: consCollect.status === 'errored' })
    : { ended: true, errored: false };
  const synLeg: BatchLeg = run.synthesize_batch_id
    ? ((synCollect = await collectDreamBatch(run.synthesize_batch_id)), { ended: synCollect.status !== 'pending', errored: synCollect.status === 'errored' })
    : { ended: true, errored: false };

  const state = nextCollectState(consLeg, synLeg, hoursSince);
  if (state === 'submitted') {
    return { dream_run_at: run.dream_run_at, state: 'submitted', note: 'batches still processing, within window' };
  }

  // Terminal. Compute each job's facts from its ACTUAL result — ended→finalize,
  // errored→incomplete+reason, never-ended(expired)→incomplete+24h note.
  const consFacts = await consolidateFacts(run, consP, consCollect);
  const synFacts = await synthesizeFacts(run, synP, synCollect);

  const journal = assembleJournal(run.reconcile ?? { flagged: 0, closed: 0, staged: 0 }, consFacts, synFacts, dreamSpent(), cap);
  if (state === 'failed') journal.note = journal.note ?? 'a batch request did not succeed — collection failed';
  if (state === 'expired') journal.note = `a batch did not complete within ${DREAM_EXPIRY_HOURS}h — run expired`;

  await finalizeDreamRun(run.dream_run_at, journal, state);
  return { dream_run_at: run.dream_run_at, state, spent: dreamSpent(), journal_status: journal.status, proposals_pending: journal.proposals_pending };
}

async function consolidateFacts(run: any, pending: ConsolidatePending, collect: CollectResult | null): Promise<ConsolidateFacts> {
  if (!run.consolidate_batch_id) return finalizeConsolidate(null, pending, run.dream_run_at); // skipped_no_input via pending.status
  if (collect && collect.status === 'ended') return finalizeConsolidate(parseDreamJson<any[]>(collect.text), pending, run.dream_run_at);
  const reason = collect && collect.status === 'errored' ? `batch errored: ${collect.reason}` : `batch did not complete within ${DREAM_EXPIRY_HOURS}h`;
  return { status: 'incomplete', auto_merged: pending.auto_merged ?? 0, proposed: { merge: 0, deprecate: 0, promote: 0 }, note: reason };
}

async function synthesizeFacts(run: any, pending: SynthesizePending, collect: CollectResult | null): Promise<SynthesizeFacts> {
  if (!run.synthesize_batch_id) return finalizeSynthesize(null, pending, run.dream_run_at); // skipped_no_input / cap-breach via pending.status
  if (collect && collect.status === 'ended') return finalizeSynthesize(parseDreamJson<any[]>(collect.text), pending, run.dream_run_at);
  const reason = collect && collect.status === 'errored' ? `batch errored: ${collect.reason}` : `batch did not complete within ${DREAM_EXPIRY_HOURS}h`;
  return { status: 'incomplete', proposed: { pattern: 0, graveyard: 0, strategy: 0 }, note: reason };
}

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
