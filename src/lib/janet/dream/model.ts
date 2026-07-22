// JANET — The Dreaming Phase: the model transport seam (two-phase Batch API).
//
// Overnight work is exactly the latency-insensitive load the Batch API is priced
// for, and a batch can take minutes to (rarely) hours. So the transport is split:
//
//   submitDreamBatch()  — night: create the one-request batch, return its id. NO
//                         polling. Also projects the call's worst-case cost so the
//                         cap can gate the NEXT submit (see wouldBreachCap).
//   collectDreamBatch() — collector: retrieve when the batch has ENDED; read the
//                         result and accrue its REALIZED cost against the budget.
//
// TWO honesty rules the rest of the build depends on:
//   1. Budget is a CONTROL, not a receipt. The projection accrues at submit and
//      gates the second submit BEFORE the batch is created — a loop that can't be
//      stopped before spend is the failure class this rebuild closes. The realized
//      spend accrues at collect and feeds the 185c376 inconsistent-guard.
//   2. Incompleteness is distinct from emptiness. A batch that hasn't ended is
//      'pending' (try again), not 'empty'. A batch that ended without a succeeded
//      result is 'errored' (→ failed), not 'empty'. A finished-but-empty parse is
//      the ONLY thing that means "genuinely nothing to propose".
//
// Ring discipline: analysis only. It returns text; it never acts.

import { anthropic } from '../../anthropic';
import { JANET_MODEL, usdCostOf } from '../config';
import { logTurnCost } from '../actions';
import { estimateTokens } from './pure';

/** Retained for callers that still reference it; the split transport reports
 *  incompleteness via return values, not throws. */
export class DreamIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DreamIncompleteError';
  }
}

// Per-run budget (USD). Module-scoped: a dream cron runs one at a time.
//   _projected — accrues at SUBMIT (the pre-submit control).
//   _spent     — accrues at COLLECT (the realized cost; feeds the guard).
let _spent = 0;
let _projected = 0;
let _cap = Infinity;
export function beginDreamBudget(capUsd: number): void {
  _spent = 0;
  _projected = 0;
  _cap = capUsd > 0 ? capUsd : Infinity;
}
export function dreamSpent(): number {
  return Math.round(_spent * 10000) / 10000;
}
export function projectedDreamSpend(): number {
  return Math.round(_projected * 10000) / 10000;
}
export function dreamCap(): number {
  return _cap;
}

/** Worst-case USD for one call: conservatively-estimated input tokens + the full
 *  max_tokens output ceiling, priced through the SAME usdCostOf the realized cost
 *  uses (one pricing source). An over-count on purpose — the cap should err toward
 *  refusing the next submit. */
export function projectDreamCost(system: string, user: string, maxTokens: number): number {
  const input_tokens = estimateTokens(system + '\n' + user);
  return usdCostOf({ input_tokens, output_tokens: maxTokens }, JANET_MODEL);
}

export interface SubmitResult {
  batchId: string;
  projected: number;
}
export interface CapBreach {
  capBreach: true;
  projected: number;
  projectedTotal: number;
  cap: number;
}

/** Submit a one-request dream batch. No polling. Accrues the projected cost.
 *  Used for the FIRST (consolidate) submit, which is unconditional. */
export async function submitDreamBatch(system: string, user: string, maxTokens = 1500): Promise<SubmitResult> {
  const projected = projectDreamCost(system, user, maxTokens);
  const batch = await anthropic.messages.batches.create({
    requests: [
      {
        custom_id: 'dream',
        params: { model: JANET_MODEL, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] },
      },
    ],
  });
  _projected += projected;
  return { batchId: batch.id, projected };
}

/** Cap-gated submit for the SECOND (synthesize) batch: project first, and if it
 *  would breach the cap, DO NOT create the batch — return the breach so the caller
 *  records the run partial. The cap stops spend before it happens. */
export async function submitDreamBatchGated(system: string, user: string, maxTokens = 1500): Promise<SubmitResult | CapBreach> {
  const projected = projectDreamCost(system, user, maxTokens);
  if (_cap !== Infinity && _projected + projected > _cap) {
    return { capBreach: true, projected, projectedTotal: Math.round((_projected + projected) * 10000) / 10000, cap: _cap };
  }
  return submitDreamBatch(system, user, maxTokens);
}

export type CollectResult =
  | { status: 'pending' }
  | { status: 'ended'; text: string; cost: number }
  | { status: 'errored'; reason: string };

/** Retrieve a submitted batch. If it hasn't ENDED, 'pending' (try next tick). If
 *  ended, read the single result: 'ended' with text + accrued cost on success,
 *  'errored' with a reason otherwise. Realized cost accrues to _spent here. */
export async function collectDreamBatch(batchId: string): Promise<CollectResult> {
  const b = await anthropic.messages.batches.retrieve(batchId);
  if ((b.processing_status as string) !== 'ended') return { status: 'pending' };

  let text = '';
  let usage: unknown = null;
  let succeeded = false;
  let reason = '';
  const results = await anthropic.messages.batches.results(batchId);
  for await (const entry of results) {
    const r = (entry as any).result;
    if (r?.type === 'succeeded') {
      const msg = r.message;
      text = (msg.content ?? [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
        .trim();
      usage = msg.usage;
      succeeded = true;
    } else {
      reason = `batch request ${r?.type ?? 'unknown'}`;
    }
  }
  if (!succeeded) return { status: 'errored', reason: reason || 'no succeeded result in batch' };

  const cost = usdCostOf(usage as any, JANET_MODEL);
  _spent += cost;
  await logTurnCost(cost, `dream collect (${(usage as any)?.input_tokens ?? 0}in/${(usage as any)?.output_tokens ?? 0}out)`);
  return { status: 'ended', text, cost };
}

/** Parse a JSON object/array out of a model reply that may be fenced or prefaced.
 *  Returns null on anything unparseable — the caller treats that as "no proposals",
 *  never as a silent failure that fabricates. */
export function parseDreamJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{' && s[0] !== '[') {
    const m = s.match(/[[{][\s\S]*[\]}]/);
    if (m) s = m[0];
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
