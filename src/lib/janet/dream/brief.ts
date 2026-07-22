// JANET — The Dreaming Phase, D4: the dream journal + the two-phase run record.
//
// The journal logic (assembleJournal, the 185c376 inconsistent-guard, headlines)
// lives in pure.ts so it is unit-tested directly; this file re-exports it and
// owns the I/O: insert the 'submitted' row at night, upsert the terminal record at
// collect (keyed on dream_run_at so a double collection UPDATES, never inserts),
// and read the latest run for the morning brief. The honesty rule holds: an
// incomplete/in-flight/failed/expired run reads as itself, never as zero.

import { supabaseAdmin } from '../../supabase';
import {
  assembleJournal,
  journalHeadline,
  dreamBriefLine,
  type JobStatus,
  type DreamJournal,
  type DreamState,
  type ReconcileFacts,
  type ConsolidateFacts,
  type SynthesizeFacts,
} from './pure';
import type { ConsolidatePending } from './consolidate';
import type { SynthesizePending } from './synthesize';

export { assembleJournal, journalHeadline, dreamBriefLine };
export type { JobStatus, DreamJournal, DreamState };

export interface LatestDreamRun {
  state: DreamState;
  dream_run_at: string;
  submitted_at: string | null;
  collected_at: string | null;
  note: string | null;
  journal: DreamJournal | null; // populated only when state === 'collected'
}

/** NIGHT: record the submitted run. reconcile facts are known now (deterministic)
 *  and persisted so they survive even if collection later expires/fails. The
 *  `pending` blob holds the per-job snapshots the collector finalizes against. */
export async function insertSubmittedRun(args: {
  dream_run_at: string;
  submitted_at: string;
  reconcile: ReconcileFacts;
  consolidate: ConsolidatePending;
  synthesize: SynthesizePending;
  cap: number | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('janet_dream_runs').insert({
    dream_run_at: args.dream_run_at,
    state: 'submitted',
    status: 'pending', // the journal verdict is unknown until collected
    submitted_at: args.submitted_at,
    consolidate_batch_id: args.consolidate.batch_id ?? null,
    synthesize_batch_id: args.synthesize.batch_id ?? null,
    pending: { consolidate: args.consolidate, synthesize: args.synthesize },
    reconcile: args.reconcile,
    consolidate: { status: args.consolidate.status },
    synthesize: { status: args.synthesize.status },
    budget: { cap: args.cap },
    proposals_pending: 0,
    note: null,
  });
  if (error) throw new Error(`insertSubmittedRun failed: ${error.message}`);
}

/** Is there already a submitted/collected dream run in the recent past? Per-day
 *  idempotency for the night cron — a second same-night submit is refused so it
 *  can't open a duplicate set of batches. TZ-agnostic 20h window (crons fire once
 *  daily; a failed/expired run is NOT counted, so a retry can re-submit). */
export async function hasRecentActiveRun(nowIso: string): Promise<boolean> {
  const cutoff = new Date(new Date(nowIso).getTime() - 20 * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from('janet_dream_runs')
    .select('id, state, submitted_at')
    .in('state', ['submitted', 'collected'])
    .gte('submitted_at', cutoff)
    .limit(1);
  return (data ?? []).length > 0;
}

/** The submitted runs the collector should try to advance. */
export async function getSubmittedRuns(): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from('janet_dream_runs')
    .select('*')
    .eq('state', 'submitted')
    .order('submitted_at', { ascending: true });
  return data ?? [];
}

/** COLLECT: write the terminal record. Keyed on dream_run_at (UNIQUE) so a second
 *  collection UPDATES rather than inserting a duplicate. Counts the run's pending
 *  proposals and stamps the journal. Returns the finalized journal. */
export async function finalizeDreamRun(dreamRunAt: string, journal: DreamJournal, state: DreamState): Promise<DreamJournal> {
  journal.dream_run_at = dreamRunAt;
  const { count } = await supabaseAdmin
    .from('janet_dream_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('dream_run_at', dreamRunAt)
    .eq('status', 'proposed');
  journal.proposals_pending = count ?? 0;

  const { error } = await supabaseAdmin.from('janet_dream_runs').upsert(
    {
      dream_run_at: dreamRunAt,
      state,
      status: journal.status,
      reconcile: journal.reconcile,
      consolidate: journal.consolidate,
      synthesize: journal.synthesize,
      budget: journal.budget,
      proposals_pending: journal.proposals_pending,
      note: journal.note ?? null,
      collected_at: new Date().toISOString(),
    },
    { onConflict: 'dream_run_at' }
  );
  if (error) throw new Error(`finalizeDreamRun failed: ${error.message}`);
  return journal;
}

/** Reconstruct a DreamJournal from a stored (collected) run row. */
function journalFromRow(data: any): DreamJournal {
  return {
    dream_run_at: data.dream_run_at,
    status: data.status,
    reconcile: data.reconcile,
    consolidate: data.consolidate,
    synthesize: data.synthesize,
    budget: data.budget,
    proposals_pending: data.proposals_pending,
    ...(data.note ? { note: data.note } : {}),
  } as DreamJournal;
}

/** The latest run, state-aware — for the morning brief fold-in and the review
 *  page. Null only if the dream has never run. */
export async function getLatestDreamRun(): Promise<LatestDreamRun | null> {
  const { data } = await supabaseAdmin
    .from('janet_dream_runs')
    .select('*')
    .order('dream_run_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    state: (data.state ?? 'collected') as DreamState,
    dream_run_at: data.dream_run_at,
    submitted_at: data.submitted_at ?? null,
    collected_at: data.collected_at ?? null,
    note: data.note ?? null,
    journal: (data.state ?? 'collected') === 'collected' ? journalFromRow(data) : null,
  };
}

/** Back-compat: the latest COLLECTED journal (used by the review page's detail
 *  render). Null when the latest run isn't collected yet. */
export async function getLatestDreamJournal(): Promise<DreamJournal | null> {
  const run = await getLatestDreamRun();
  return run?.journal ?? null;
}
