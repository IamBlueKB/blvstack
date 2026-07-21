// JANET — The Dreaming Phase, D4: the dream journal.
//
// Turns a night's run into one honest, deterministic record (no model): what
// reconcile did, what consolidate/synthesize proposed OR whether they didn't
// finish, the budget spent, and how many proposals await review. Stored in
// janet_dream_runs; the morning brief folds the latest one in; the review page
// reads it. The honesty rule holds here: an incomplete job reads as "didn't
// finish tonight", never as zero.

import { supabaseAdmin } from '../../supabase';
import type { ReconcileSummary } from './reconcile';
import type { ConsolidateSummary } from './consolidate';
import type { SynthesizeSummary } from './synthesize';
import { dreamSpent, dreamCap } from './model';

export type JobStatus = 'ok' | 'incomplete' | 'skipped_no_input';

export interface DreamJournal {
  dream_run_at: string;
  // 'partial'  = a job did not finish (result unknown)
  // 'idle'     = nothing failed, but a job had no input and never ran — the loop
  //              did not actually learn anything. Reported as idle, never as ok.
  status: 'ok' | 'partial' | 'idle';
  reconcile: { flagged: number; closed: number; staged: number };
  consolidate: { status: JobStatus; auto_merged: number; proposed: ConsolidateSummary['proposed']; note?: string };
  synthesize: { status: JobStatus; proposed: SynthesizeSummary['proposed']; note?: string };
  budget: { spent: number; cap: number | null };
  proposals_pending: number;
}

/** Build the journal object from the three job summaries. Pure — no I/O. */
export function assembleJournal(rec: ReconcileSummary, cons: ConsolidateSummary, syn: SynthesizeSummary): DreamJournal {
  const anyIncomplete = cons.status === 'incomplete' || syn.status === 'incomplete';
  const anySkipped = cons.status === 'skipped_no_input' || syn.status === 'skipped_no_input';
  // A job that never ran is not a success. 'ok' requires that the jobs actually ran.
  const status: DreamJournal['status'] = anyIncomplete ? 'partial' : anySkipped ? 'idle' : 'ok';
  const cap = dreamCap();
  return {
    dream_run_at: cons.dream_run_at,
    status,
    reconcile: { flagged: rec.recs.flagged, closed: rec.recs.closed, staged: rec.predictions.staged },
    consolidate: { status: cons.status, auto_merged: cons.auto_merged, proposed: cons.proposed, ...(cons.note ? { note: cons.note } : {}) },
    synthesize: { status: syn.status, proposed: syn.proposed, ...(syn.note ? { note: syn.note } : {}) },
    budget: { spent: dreamSpent(), cap: Number.isFinite(cap) ? cap : null },
  proposals_pending: 0, // filled by persistDreamRun once proposals are counted
  };
}

/** Count the review-gated proposals from this run and persist the journal row. */
export async function persistDreamRun(journal: DreamJournal): Promise<DreamJournal> {
  const { count } = await supabaseAdmin
    .from('janet_dream_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('dream_run_at', journal.dream_run_at)
    .eq('status', 'proposed');
  journal.proposals_pending = count ?? 0;

  await supabaseAdmin.from('janet_dream_runs').insert({
    dream_run_at: journal.dream_run_at,
    reconcile: journal.reconcile,
    consolidate: journal.consolidate,
    synthesize: journal.synthesize,
    budget: journal.budget,
    proposals_pending: journal.proposals_pending,
    status: journal.status,
  });
  return journal;
}

/** The most recent night's journal — for the morning brief fold-in and the
 *  review page. Null if the dream has never run. */
export async function getLatestDreamJournal(): Promise<DreamJournal | null> {
  const { data } = await supabaseAdmin
    .from('janet_dream_runs')
    .select('dream_run_at, reconcile, consolidate, synthesize, budget, proposals_pending, status')
    .order('dream_run_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    dream_run_at: data.dream_run_at,
    status: data.status,
    reconcile: data.reconcile,
    consolidate: data.consolidate,
    synthesize: data.synthesize,
    budget: data.budget,
    proposals_pending: data.proposals_pending,
  } as DreamJournal;
}

/** One honest line for the morning brief. Distinguishes "didn't finish" from
 *  "nothing found" — the whole point. */
/** One honest line per job. "didn't finish", "didn't run", and "ran and found
 *  nothing" are three different facts and must never render the same. */
function jobLine(label: string, status: JobStatus, note: string | undefined, ranOk: string): string {
  if (status === 'incomplete') return `${label} didn't finish tonight (${note ?? 'incomplete'})`;
  if (status === 'skipped_no_input') return `${label} didn't run — ${note ?? 'no input'}`;
  return `${label}: ${ranOk}`;
}

export function journalHeadline(j: DreamJournal): string {
  const parts: string[] = [];
  const r = j.reconcile;
  if (r.flagged || r.closed || r.staged) parts.push(`reconciled ${r.closed} dead rec(s) closed, ${r.flagged} flagged, ${r.staged} prediction(s) staged`);
  parts.push(jobLine('consolidate', j.consolidate.status, j.consolidate.note, `${j.consolidate.auto_merged} exact-dup merge(s) applied`));
  parts.push(jobLine('synthesize', j.synthesize.status, j.synthesize.note, `${j.synthesize.proposed.pattern + j.synthesize.proposed.graveyard + j.synthesize.proposed.strategy} candidate(s)`));
  const lead = j.status === 'idle' ? 'Dreamt overnight (IDLE — a job had no input and never ran)' : 'Dreamt overnight';
  return `${lead}: ${parts.join('; ')}. ${j.proposals_pending} proposal(s) awaiting your review.`;
}
