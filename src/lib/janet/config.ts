// JANET v1 — model config (spec §5.1)
// JANET_MODEL env var overrides; default per Blue's 2026-07-09 decision.
// Sonnet-class: fast, cheap, strong tool use. Config-flag to switch later.

export const JANET_MODEL = import.meta.env.JANET_MODEL || 'claude-sonnet-4-6';

/** Max tool-use iterations per turn (spec §5.1: ~15, graceful cap). */
export const MAX_TOOL_ITERATIONS = 15;

/** Recent janet_messages rows loaded as conversation history per request. */
export const HISTORY_LIMIT = 30;

// ─── Cost governance (JANET_ADMIN_NOTEPAD_SPEC Task 1) ──────────────
/** Hard-ish ceiling on estimated API cost for a single turn (USD). A simple
 *  safety rail against a runaway tool loop — not a full FinOps system. */
export const JANET_MAX_TASK_COST = Number(import.meta.env.JANET_MAX_TASK_COST ?? 0.5);

// Sonnet-class $/1M-token rates used to estimate spend.
const RATE_INPUT = 3.0;
const RATE_OUTPUT = 15.0;
const RATE_CACHE_READ = 0.3;
const RATE_CACHE_WRITE = 3.75;

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/** Estimated USD cost of one model response's token usage. */
export function usdCostOf(u: TokenUsage | null | undefined): number {
  if (!u) return 0;
  return (
    ((u.input_tokens ?? 0) * RATE_INPUT +
      (u.output_tokens ?? 0) * RATE_OUTPUT +
      (u.cache_read_input_tokens ?? 0) * RATE_CACHE_READ +
      (u.cache_creation_input_tokens ?? 0) * RATE_CACHE_WRITE) /
    1_000_000
  );
}
