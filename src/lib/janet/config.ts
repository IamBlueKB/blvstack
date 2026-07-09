// JANET v1 — model config (spec §5.1)
// JANET_MODEL env var overrides; default per Blue's 2026-07-09 decision.
// Sonnet-class: fast, cheap, strong tool use. Config-flag to switch later.

export const JANET_MODEL = import.meta.env.JANET_MODEL || 'claude-sonnet-4-6';

/** Max tool-use iterations per turn (spec §5.1: ~15, graceful cap). */
export const MAX_TOOL_ITERATIONS = 15;

/** Recent janet_messages rows loaded as conversation history per request. */
export const HISTORY_LIMIT = 30;
