// JANET v1 — model config (spec §5.1)
// JANET_MODEL env var overrides; default per Blue's 2026-07-09 decision.
// Sonnet-class: fast, cheap, strong tool use. Config-flag to switch later.

// ─── Model tiering (v2 spec 1.7) ───────────────────────────────────
// Sonnet drives the tool loop (fast, cheap, 95% of work). Escalate to Opus for
// hard one-shots (proposal drafting, intelligence brief, complex audit reads);
// reserve Fable — expensive. HEAVY/MAX default to the loop model, so escalation
// is a no-op until Blue points the env at a valid Opus/Fable id (no breakage).
export const JANET_MODEL = import.meta.env.JANET_MODEL || 'claude-sonnet-4-6';
export const JANET_MODEL_HEAVY = import.meta.env.JANET_MODEL_HEAVY || JANET_MODEL; // Opus for hard one-shots
export const JANET_MODEL_MAX = import.meta.env.JANET_MODEL_MAX || JANET_MODEL_HEAVY; // Fable — reserve

/** Max tool-use iterations per turn (spec §5.1: ~15, graceful cap). */
export const MAX_TOOL_ITERATIONS = 15;

/** Recent janet_messages rows loaded as conversation history per request. */
export const HISTORY_LIMIT = 30;

// ─── Cost governance (Task 1) — now per-model-rate-aware (v2 spec 1.7) ──
/** Hard-ish ceiling on estimated API cost for a single turn (USD). A simple
 *  safety rail against a runaway tool loop — not a full FinOps system. */
export const JANET_MAX_TASK_COST = Number(import.meta.env.JANET_MAX_TASK_COST ?? 0.5);

type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };
// $/1M tokens, matched by model-family prefix so version suffixes don't matter.
// Opus is the escalation target — pricing it as Sonnet (the old bug) would let an
// escalated turn blow past JANET_MAX_TASK_COST before the breaker fires.
const RATES: Record<string, Rate> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  fable: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, // placeholder (priced like Opus) until confirmed
};
function ratesFor(model?: string): Rate {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return RATES.opus;
  if (m.includes('haiku')) return RATES.haiku;
  if (m.includes('fable')) return RATES.fable;
  return RATES.sonnet;
}

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/** Estimated USD cost of one model response's token usage, priced for the model
 *  that produced it. Defaults to Sonnet rates when the model is unknown. */
export function usdCostOf(u: TokenUsage | null | undefined, model?: string): number {
  if (!u) return 0;
  const r = ratesFor(model);
  return (
    ((u.input_tokens ?? 0) * r.input +
      (u.output_tokens ?? 0) * r.output +
      (u.cache_read_input_tokens ?? 0) * r.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * r.cacheWrite) /
    1_000_000
  );
}
