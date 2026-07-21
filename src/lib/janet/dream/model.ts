// JANET — The Dreaming Phase: the model transport seam (D4: Batch API).
//
// All dream model calls go through dreamComplete(). Overnight work is exactly the
// latency-insensitive load the Batch API is priced for (~half cost), so each call
// is submitted as a one-request batch and polled to completion within a bounded
// window. Nothing else in the dreaming code changed — the seam swap lives here.
//
// TWO honesty rules the rest of the build depends on:
//   1. Budget. The dream runs under its OWN cap (the per-turn breaker does not
//      cover crons). beginDreamBudget() resets it per run; every call adds its
//      cost; a call that would exceed the cap throws DreamIncompleteError.
//   2. Incompleteness is distinct from emptiness. If a batch does not finish in
//      the window (or the budget is spent, or a batch request errors),
//      dreamComplete throws DreamIncompleteError. The caller records the job as
//      "did not finish tonight" — NEVER as "0 proposals". A finished-but-empty
//      result is a normal return, and means genuinely nothing to propose.
//
// Ring discipline: analysis only. It returns text; it never acts.

import { anthropic } from '../../anthropic';
import { JANET_MODEL, usdCostOf } from '../config';
import { logTurnCost } from '../actions';

export interface DreamCompletion {
  text: string;
  cost: number;
}

/** Thrown when a dream model call could not complete — batch didn't finish in the
 *  window, the budget was exhausted, or a batch request errored. Signals "did not
 *  finish", explicitly NOT "nothing found". */
export class DreamIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DreamIncompleteError';
  }
}

// Per-run budget (USD). Module-scoped: a dream cron runs one at a time.
let _spent = 0;
let _cap = Infinity;
export function beginDreamBudget(capUsd: number): void {
  _spent = 0;
  _cap = capUsd > 0 ? capUsd : Infinity;
}
export function dreamSpent(): number {
  return Math.round(_spent * 10000) / 10000;
}
export function dreamCap(): number {
  return _cap;
}

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_MS = 120_000; // ~2 min per call; two calls stay within a 300s cron

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One dream analysis call, via the Batch API. Deterministic (temperature 0) — we
 * want stable, grounded proposals, not creative drift. Throws DreamIncompleteError
 * on budget-exhausted / batch-not-finished / batch-request-errored.
 */
export async function dreamComplete(system: string, user: string, maxTokens = 1500): Promise<DreamCompletion> {
  if (_spent >= _cap) {
    throw new DreamIncompleteError(`Dream budget exhausted ($${dreamSpent().toFixed(2)} of $${_cap.toFixed(2)}) before this call.`);
  }

  const batch = await anthropic.messages.batches.create({
    requests: [
      {
        custom_id: 'dream',
        params: {
          model: JANET_MODEL,
          max_tokens: maxTokens,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: user }],
        },
      },
    ],
  });

  // Poll until the batch ends or the window closes.
  const started = Date.now();
  let status = batch.processing_status as string;
  while (status !== 'ended') {
    if (Date.now() - started > POLL_MAX_MS) {
      throw new DreamIncompleteError(`Batch ${batch.id} did not finish within ${Math.round(POLL_MAX_MS / 1000)}s — treated as incomplete, not empty.`);
    }
    await sleep(POLL_INTERVAL_MS);
    const b = await anthropic.messages.batches.retrieve(batch.id);
    status = b.processing_status as string;
  }

  // Retrieve the single result.
  let text = '';
  let usage: unknown = null;
  const results = await anthropic.messages.batches.results(batch.id);
  for await (const entry of results) {
    const r = (entry as any).result;
    if (r?.type === 'succeeded') {
      const msg = r.message;
      text = (msg.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();
      usage = msg.usage;
    } else {
      throw new DreamIncompleteError(`Batch ${batch.id} request did not succeed (${r?.type ?? 'unknown'}) — incomplete, not empty.`);
    }
  }

  const cost = usdCostOf(usage as any, JANET_MODEL);
  _spent += cost;
  await logTurnCost(cost, `dream batch (${(usage as any)?.input_tokens ?? 0}in/${(usage as any)?.output_tokens ?? 0}out)`);
  return { text, cost };
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
