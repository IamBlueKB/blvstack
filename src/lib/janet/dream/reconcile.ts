// JANET — The Dreaming Phase, Job 1: Reconcile (deterministic, no model).
//
// This is the nightly pass that connects two loops the code currently leaves
// open, without a conversation:
//
//   1. recommendation -> outcome -> scorecard.  Open recommendations whose
//      linked deal has already resolved (won/lost/delivered) get FLAGGED for
//      resolution, and the persistent ones (flagged long ago, still no outcome)
//      get CLOSED, so dead recs stop injecting into every prompt forever.
//
//   2. prediction -> score -> pattern-confidence.  Open predictions whose
//      linked deal has resolved get STAGED with the factual outcome as `actual`,
//      leaving `outcome` null (= "ready to score"). The confirm/contradict
//      judgment is the one genuinely model-needing step (spec Job 1), so it is
//      deliberately NOT guessed here — it runs in a later model pass or by Blue
//      in the morning brief, where the confidence math (already in
//      score_prediction) fires.
//
// Everything here is deterministic and grounded in primary records (the deal's
// own resolved state). Nothing here reaches a person — Ring 1/2 discipline.

import { supabaseAdmin } from '../../supabase';
import { logJanetAction } from '../actions';

/** A deal is terminal when it has a won/lost outcome or a terminal stage. Matches
 *  the 5.4 reactive-flag definition in update_deal (ring2.ts) exactly. */
const TERMINAL_STAGES = new Set(['won', 'lost', 'delivered']);
/** Grace window: a terminal-linked open rec is FLAGGED first (a chance to record
 *  a real outcome), and only CLOSED once it has sat flagged this long with none. */
export const RECONCILE_GRACE_DAYS = 14;

export interface ReconcileSummary {
  ran_at: string;
  recs: { flagged: number; closed: number; flagged_ids: string[]; closed_ids: string[] };
  predictions: { staged: number; staged_ids: string[] };
}

const daysSince = (iso: string | null): number =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;

function dealState(d: { outcome: string | null; stage: string | null }): string | null {
  if (d.outcome === 'won' || d.outcome === 'lost') return d.outcome;
  if (d.stage && TERMINAL_STAGES.has(d.stage)) return d.stage;
  return null;
}

/**
 * Run the deterministic reconcile sweep. Safe to run repeatedly (idempotent):
 * a rec already flagged is not re-flagged, a rec already closed is not re-touched,
 * a prediction already staged (actual set) is left alone.
 */
export async function runReconcile(): Promise<ReconcileSummary> {
  const ran_at = new Date().toISOString();
  const summary: ReconcileSummary = {
    ran_at,
    recs: { flagged: 0, closed: 0, flagged_ids: [], closed_ids: [] },
    predictions: { staged: 0, staged_ids: [] },
  };

  // Build the terminal-deal map once (id -> {state, name, resolved_at}).
  const { data: deals } = await supabaseAdmin
    .from('janet_deals')
    .select('id, name, outcome, outcome_at, stage, updated_at');
  const terminal = new Map<string, { state: string; name: string; at: string | null }>();
  for (const d of deals ?? []) {
    const state = dealState(d as any);
    if (state) terminal.set(d.id, { state, name: (d as any).name ?? d.id, at: (d as any).outcome_at ?? (d as any).updated_at ?? null });
  }
  if (terminal.size === 0) return summary; // nothing resolved -> nothing to reconcile

  // ── Sweep 1: zombie recommendations ────────────────────────────────────────
  // Open (outcome null), deal-linked, not already superseded.
  const { data: openRecs } = await supabaseAdmin
    .from('janet_recommendations')
    .select('id, subject_id, flagged_at, status')
    .eq('subject_type', 'deal')
    .is('outcome', null)
    .neq('status', 'superseded');

  for (const r of openRecs ?? []) {
    const t = terminal.get((r as any).subject_id);
    if (!t) continue; // linked deal not resolved -> leave it open
    if (!(r as any).flagged_at) {
      // First detection: flag it (a window to record a real outcome). This is the
      // proactive form of the 5.4 flag, catching deals closed outside update_deal.
      const { error } = await supabaseAdmin
        .from('janet_recommendations')
        .update({ flagged_at: ran_at, flagged_reason: `linked deal "${t.name}" resolved (${t.state}) — reconcile` })
        .eq('id', (r as any).id)
        .is('flagged_at', null); // race guard: don't clobber a concurrent flag
      if (!error) { summary.recs.flagged++; summary.recs.flagged_ids.push((r as any).id); }
    } else if (daysSince((r as any).flagged_at) >= RECONCILE_GRACE_DAYS) {
      // Persistent zombie: flagged long ago, still no outcome. Close it so it stops
      // injecting. outcome='unknown' is honest — the direction (worked/failed) is a
      // judgment we do NOT invent here; blue_verdict is left null.
      const { error } = await supabaseAdmin
        .from('janet_recommendations')
        .update({
          outcome: 'unknown',
          outcome_recorded_at: ran_at,
          status: 'superseded',
          outcome_detail: `Auto-closed by nightly reconcile: linked deal "${t.name}" resolved (${t.state}) and no outcome was recorded within ${RECONCILE_GRACE_DAYS}d of flagging.`,
        })
        .eq('id', (r as any).id)
        .is('outcome', null); // race guard: only close if still open
      if (!error) { summary.recs.closed++; summary.recs.closed_ids.push((r as any).id); }
    }
  }

  // ── Sweep 2: resolvable predictions ────────────────────────────────────────
  // Open (outcome null), deal-linked, not yet staged (actual still null).
  const { data: openPreds } = await supabaseAdmin
    .from('janet_predictions')
    .select('id, subject_id, actual')
    .eq('subject_type', 'deal')
    .is('outcome', null)
    .is('actual', null);

  for (const p of openPreds ?? []) {
    const t = terminal.get((p as any).subject_id);
    if (!t) continue;
    const actual = `Deal "${t.name}" resolved: ${t.state}${t.at ? ` on ${String(t.at).slice(0, 10)}` : ''} (reconcile-detected; scoring pending).`;
    const { error } = await supabaseAdmin
      .from('janet_predictions')
      .update({ actual })
      .eq('id', (p as any).id)
      .is('actual', null); // race guard
    if (!error) { summary.predictions.staged++; summary.predictions.staged_ids.push((p as any).id); }
  }

  // One ledger row summarizing the sweep (Ring 2 internal bookkeeping, autonomous).
  const touched = summary.recs.flagged + summary.recs.closed + summary.predictions.staged;
  if (touched > 0) {
    await logJanetAction({
      tool_name: 'dream_reconcile',
      ring: 2,
      input: { grace_days: RECONCILE_GRACE_DAYS },
      approved_by_user: null,
      status: 'completed',
      output_summary: `Reconcile: flagged ${summary.recs.flagged} + closed ${summary.recs.closed} dead recs; staged ${summary.predictions.staged} predictions to score.`,
    });
  }

  return summary;
}
