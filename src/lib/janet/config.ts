// JANET v1 — model config (spec §5.1)
// JANET_MODEL env var overrides; default per Blue's 2026-07-09 decision.
// Sonnet-class: fast, cheap, strong tool use. Config-flag to switch later.

// ─── Model tiering (v2 spec 1.7) ───────────────────────────────────
// Sonnet drives the tool loop (fast, cheap, 95% of work). Escalate to the HEAVY
// (Opus-class) model for hard one-shots — proposal drafting + the weekly PSRx
// brief. HEAVY defaults to the loop model only as a no-breakage fallback; if it
// isn't pointed at a real Opus id, escalation is a silent no-op — so resolve it
// through heavyModel() at the escalation site, which warns loudly in that case.
export const JANET_MODEL = import.meta.env.JANET_MODEL || 'claude-sonnet-4-6';
export const JANET_MODEL_HEAVY = import.meta.env.JANET_MODEL_HEAVY || 'claude-opus-5-5'; // Opus for hard one-shots

// ─── Her brain: the chat tool loop (brain.ts) ─────────────────────────
// Opus 5.5 (Blue's call, 2026-09-25): the loop is where her judgment lives — what to
// look up, which record, when to ask. Deliberately SEPARATE from JANET_MODEL: the
// helper one-shots (dream batch, notepad, initiative, doc assist) send params Opus
// 5.5 rejects (temperature) or cap output below its always-on thinking (500 tokens),
// so they stay on JANET_MODEL until each is migrated.
export const JANET_CHAT_MODEL = import.meta.env.JANET_CHAT_MODEL || 'claude-opus-5-5';
/** Opus 5.5 always thinks; effort is the dial. Its API default is 'medium' (where it
 *  beats Opus 5 at 'high') — set explicitly so a default change can't move it. */
export const JANET_CHAT_EFFORT = (import.meta.env.JANET_CHAT_EFFORT || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Per model call; thinking counts toward it, so it's sized for thinking + reply (streamed). */
export const JANET_CHAT_MAX_TOKENS = 32000;

/** Models that ALWAYS think (it can't be disabled) — thinking spends from max_tokens,
 *  so a budget sized for the reply alone comes back cut off or empty. */
export function alwaysThinks(model: string): boolean {
  return /^claude-(opus-5-5|fable-5|mythos-5)/.test(model);
}
/** Headroom added on top of a reply budget for an always-thinking model. */
export const THINKING_HEADROOM = 12000;
// Cheap model for the trust-stack checks (entailment gate + outbound validator, 2.8) —
// a fast NLI-style verifier, not the loop. Defaults to Haiku.
export const JANET_MODEL_LIGHT = import.meta.env.JANET_MODEL_LIGHT || 'claude-haiku-4-5-20251001';

/**
 * Resolve the escalation ("heavy") model at the call site. FAIL-LOUD: if HEAVY
 * collapsed to the base loop model, escalation is a no-op — emit a visible
 * warning so "Opus escalation is on" can never be silently false again (Finding
 * F). Returns the model id to use for the escalated call.
 */
export function heavyModel(): string {
  if (JANET_MODEL_HEAVY === JANET_MODEL) {
    console.warn(
      `[janet] ⚠ ESCALATION NO-OP: JANET_MODEL_HEAVY resolved to the base loop model "${JANET_MODEL}". ` +
        `Proposal drafting / the weekly brief are running on the LOOP model, not Opus. ` +
        `Set JANET_MODEL_HEAVY to a real Opus id (e.g. claude-opus-5-5) to actually escalate.`
    );
  }
  return JANET_MODEL_HEAVY;
}

/** Max tool-use iterations per turn (spec §5.1: ~15, graceful cap). */
export const MAX_TOOL_ITERATIONS = 15;

/** Recent janet_messages rows loaded as conversation history per request. */
export const HISTORY_LIMIT = 30;

// ─── Cost governance (Task 1) — now per-model-rate-aware (v2 spec 1.7) ──
/** Hard-ish ceiling on estimated API cost for a single turn (USD). A simple
 *  safety rail against a runaway tool loop — not a full FinOps system. */
// $1.00 since the Opus 5.5 brain (2026-09-25): measured first-turn cost is ~$0.32 (the
// one-time cache write), ~$0.05 after — the same ~3x headroom $0.50 gave on Sonnet.
export const JANET_MAX_TASK_COST = Number(import.meta.env.JANET_MAX_TASK_COST ?? 1.0);

/** The dreaming phase's OWN budget cap (USD per nightly run). The per-turn breaker
 *  above does not cover crons — this is that gap closed for the dream. Overnight the
 *  dream runs on the Batch API (~half cost), so this is a generous ceiling. */
export const JANET_DREAM_MAX_COST = Number(import.meta.env.JANET_DREAM_MAX_COST ?? 1.0);

type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };
// $/1M tokens, per MODEL, most specific id first (first prefix match wins, so
// 'claude-opus-5-5' is matched before 'claude-opus-5'). cacheWrite = 5-minute write
// (1.25x input). Pricing a model wrong breaks both ends of cost governance: too LOW
// lets a turn blow past JANET_MAX_TASK_COST; too HIGH trips the breaker on normal
// turns. Both happened: Opus was once priced as Sonnet, then every Opus id sat at
// the Opus 4.0 rate ($15/$75) — 3x the real Opus 4.8 price, so heavy calls were
// logged at 3x (the 2026-09-21 brief "cost" $1.08, really ~$0.36).
const RATES: Array<[prefix: string, rate: Rate]> = [
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus', { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }], // Opus 4.1 / 4.0
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }], // Fable 5 / 5.1 (5.1 cache reads $0.25 — kept conservative)
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['claude-sonnet', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }], // Sonnet 4.x
  ['claude-haiku', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
];
/** Unknown ids price as current-gen Opus — high enough that the breaker still bites. */
const DEFAULT_RATE: Rate = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
function ratesFor(model?: string): Rate {
  const m = (model || '').toLowerCase();
  return RATES.find(([prefix]) => m.startsWith(prefix))?.[1] ?? DEFAULT_RATE;
}

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/** Estimated USD cost of one model response's token usage, priced for the model
 *  that produced it. An unknown id prices as current-gen Opus (DEFAULT_RATE). */
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
