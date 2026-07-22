// JANET — The Dreaming Phase: the PURE core (no I/O, no import.meta.env).
//
// Everything here is a plain function with no dependency on supabase, anthropic,
// or Astro env — so it runs under `tsx`/node and is unit-tested directly (see
// scripts/dream-*.test.ts). The two-phase loop's load-bearing decisions live
// here on purpose: the journal + the inconsistent-run guard (185c376), the
// collect-time state machine, the proposal idempotency key, and the pre-submit
// cap control. If a belief is load-bearing it should be a tested function, not a
// comment — that is the whole point of this file.

// ── Journal types ───────────────────────────────────────────────────────────

export type JobStatus = 'ok' | 'incomplete' | 'skipped_no_input';

/** The reconcile facts the journal shows — the reduced, persisted shape. */
export interface ReconcileFacts {
  flagged: number;
  closed: number;
  staged: number;
}

export interface ConsolidateFacts {
  status: JobStatus;
  auto_merged: number;
  proposed: { merge: number; deprecate: number; promote: number };
  note?: string;
}

export interface SynthesizeFacts {
  status: JobStatus;
  proposed: { pattern: number; graveyard: number; strategy: number };
  note?: string;
}

export interface DreamJournal {
  dream_run_at: string;
  // 'partial'      = a job did not finish (result unknown)
  // 'idle'         = nothing failed, but a job had no input and never ran
  // 'inconsistent' = the run reports success the accounting contradicts (its OWN
  //                  status — never downgraded into another, so a real bug can't
  //                  blend into a normal-looking run). See assembleJournal.
  status: 'ok' | 'partial' | 'idle' | 'inconsistent';
  note?: string;
  reconcile: ReconcileFacts;
  consolidate: ConsolidateFacts;
  synthesize: SynthesizeFacts;
  budget: { spent: number; cap: number | null };
  proposals_pending: number;
}

/** Build the journal from the three job summaries + the realized spend/cap. Pure:
 *  spend and cap are PASSED IN (the collector reads them from the dream budget
 *  after accruing both batch costs) rather than read from module state — so the
 *  185c376 inconsistent-guard is testable without a live budget. */
export function assembleJournal(
  reconcile: ReconcileFacts,
  cons: ConsolidateFacts,
  syn: SynthesizeFacts,
  spent: number,
  cap: number | null
): DreamJournal {
  const anyIncomplete = cons.status === 'incomplete' || syn.status === 'incomplete';
  const anySkipped = cons.status === 'skipped_no_input' || syn.status === 'skipped_no_input';
  // A job that never ran is not a success. 'ok' requires the jobs actually ran.
  let status: DreamJournal['status'] = anyIncomplete ? 'partial' : anySkipped ? 'idle' : 'ok';
  let note: string | undefined;

  // INVARIANT (185c376): 'ok' means both model passes actually ran — and a pass
  // that ran costs money. So ok + $0 spend is a contradiction, not a clean run.
  // It gets its OWN status rather than being downgraded into 'idle'/'skipped':
  // downgrading would let a genuine bug render as an ordinary quiet night and
  // never get looked at. Only checked for 'ok': $0 on a 'partial' run (batch
  // never completed) or an 'idle' run is expected.
  if (status === 'ok' && spent === 0) {
    status = 'inconsistent';
    note =
      'Run reported success but $0 was spent and no model call was recorded. Two possible causes, BOTH requiring investigation: (1) a job returned ok without actually calling the model, or (2) the model ran but budget accounting failed to record the spend. Do not treat this as a completed run — the reported counts cannot be trusted until which one it is has been established.';
  }

  return {
    dream_run_at: '', // filled by the caller (it holds the run stamp)
    status,
    reconcile,
    consolidate: { status: cons.status, auto_merged: cons.auto_merged, proposed: cons.proposed, ...(cons.note ? { note: cons.note } : {}) },
    synthesize: { status: syn.status, proposed: syn.proposed, ...(syn.note ? { note: syn.note } : {}) },
    budget: { spent, cap },
    ...(note ? { note } : {}),
    proposals_pending: 0, // filled once proposals are counted
  };
}

/** One honest line per job. "didn't finish", "didn't run", and "ran and found
 *  nothing" are three different facts and must never render the same. */
export function jobLine(label: string, status: JobStatus, note: string | undefined, ranOk: string): string {
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
  // An inconsistent run must read as WRONG, not a quiet night — it leads and
  // carries its reason so it cannot be skimmed past.
  if (j.status === 'inconsistent') {
    return `⚠ INCONSISTENT RUN — do not treat as complete: ${j.note ?? 'reported success contradicted by $0 spend'} (reported: ${parts.join('; ')}.)`;
  }
  const lead = j.status === 'idle' ? 'Dreamt overnight (IDLE — a job had no input and never ran)' : 'Dreamt overnight';
  return `${lead}: ${parts.join('; ')}. ${j.proposals_pending} proposal(s) awaiting your review.`;
}

// ── The collect-time state machine ──────────────────────────────────────────

export type DreamState = 'submitted' | 'collected' | 'failed' | 'expired';

export interface BatchLeg {
  /** true once this job's batch has processing_status 'ended'. Jobs that never
   *  submitted a batch (skipped_no_input / cap-breach) count as ended-with-no-work. */
  ended: boolean;
  /** true if the batch ended but its request did not succeed. */
  errored: boolean;
}

export const DREAM_EXPIRY_HOURS = 24;

/** Given the two legs and the clock, what terminal (or holding) state is this
 *  submitted run in? The ONE place the transition rule lives.
 *   - any leg errored (and both legs resolved)        → failed
 *   - past the expiry window and a leg hasn't ended    → expired
 *   - both legs ended                                  → collected
 *   - otherwise (still running, within window)         → submitted (hold)
 *  Expiry is checked BEFORE "still running" so a batch that never ends can't hold
 *  the run open forever; but a run whose legs both ENDED collects even if we only
 *  looked after 24h (a finished result is never thrown away). */
export function nextCollectState(cons: BatchLeg, syn: BatchLeg, hoursSinceSubmit: number): DreamState {
  const bothEnded = cons.ended && syn.ended;
  if (bothEnded) return cons.errored || syn.errored ? 'failed' : 'collected';
  if (hoursSinceSubmit >= DREAM_EXPIRY_HOURS) return 'expired';
  return 'submitted';
}

/** The morning-brief line for the latest run — NEVER null/silent. In-flight and
 *  terminal-non-collected states read as themselves; a collected run defers to
 *  the journal headline. */
export function dreamBriefLine(run: {
  state: DreamState;
  submitted_at?: string | null;
  note?: string | null;
  journal?: DreamJournal | null;
}): string {
  const at = run.submitted_at ? new Date(run.submitted_at).toISOString().slice(11, 16) + ' UTC' : 'earlier';
  switch (run.state) {
    case 'submitted':
      return `Dream consolidation IN FLIGHT — batches submitted ${at}, results not yet collected. The journal lands once the collector retrieves them.`;
    case 'failed':
      return `⚠ Dream run FAILED to collect — ${run.note ?? 'a batch request did not succeed'}. No journal for last night; investigate.`;
    case 'expired':
      return `⚠ Dream run EXPIRED — a batch did not complete within ${DREAM_EXPIRY_HOURS}h of ${at}. Overnight consolidation did not happen; not a quiet night.`;
    case 'collected':
      return run.journal ? journalHeadline(run.journal) : 'Dreamt overnight (journal unavailable).';
  }
}

// ── Pre-submit cap control (the projection gate) ────────────────────────────

/** Conservative token estimate for a prompt string. Deliberately OVER-counts
 *  (≈3.5 chars/token vs the usual 4) so the cap gate errs toward NOT submitting —
 *  the safe direction for a spend control. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ? text.length : 0) / 3.5);
}

/** The gate decision, pure: would adding `thisProjection` to what's already
 *  projected breach the cap? A null/Infinite cap never breaches. */
export function wouldBreachCap(projectedSoFar: number, thisProjection: number, cap: number | null): boolean {
  if (cap == null || !Number.isFinite(cap)) return false;
  return projectedSoFar + thisProjection > cap;
}

// ── Proposal idempotency key ────────────────────────────────────────────────

/** FNV-1a (32-bit) hex — a small, stable, dependency-free string hash. Same input
 *  → same key across collector re-runs, so a re-collection of the same (fixed,
 *  temperature-0) batch result upserts onto the existing proposal instead of
 *  inserting a duplicate. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The natural key for a dream proposal. Stable across re-collections of the same
 *  run (the model output is fixed), distinct across different proposals in the
 *  same run. Keyed on the run + job + kind + target + a content hash of the
 *  semantic payload (summary, payload, sorted provenance ids). */
export function proposalIdempotencyKey(input: {
  dream_run_at: string;
  job: string;
  kind: string;
  target_id?: string | null;
  summary: string;
  payload?: Record<string, unknown>;
  provenance?: { table: string; id: string }[];
}): string {
  const prov = (input.provenance ?? [])
    .map((p) => `${p.table}:${p.id}`)
    .sort()
    .join(',');
  const canonical = [
    input.dream_run_at,
    input.job,
    input.kind,
    input.target_id ?? '',
    (input.summary ?? '').trim().toLowerCase(),
    JSON.stringify(input.payload ?? {}),
    prov,
  ].join('|');
  return `dp_${input.dream_run_at.slice(0, 10)}_${input.job}_${input.kind}_${fnv1a(canonical)}`;
}
