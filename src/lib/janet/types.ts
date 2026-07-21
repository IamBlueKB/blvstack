// JANET v1 — shared types (spec/JANET_V1_SPEC.md §4.3, §6)

/**
 * Three-ring authority model, enforced in code (spec §2).
 * Ring 1 — read freely, no approval, no logging requirement.
 * Ring 2 — reversible internal writes, executed without per-action approval
 *          but ALWAYS logged to janet_actions.
 * Ring 3 — external or irreversible. Draft + present, Blue approves, then
 *          execute. Approval outcome logged.
 */
export type JanetRing = 1 | 2 | 3;

/** What page Blue was on when the message was sent (spec §4.3). */
export type PageContext = {
  path: string;                      // '/admin/prospects/abc-123'
  entity_type?: string;              // 'prospect' | 'deal' | 'site' | ...
  entity_id?: string;
  entity_summary?: Record<string, unknown>;  // key fields of the open record
  client_id?: string;                // when the open record belongs to a client — scopes JANET's thread (Feature 1)
  client_name?: string;              // client account name, for thread titling/display
};

/** Execution context passed to every tool handler. */
export type JanetContext = {
  pageContext?: PageContext | null;
  /** Report USD spent by a nested/escalated model call so it counts toward the
   *  turn's cost budget (v2 spec 1.7). Set by the brain; no-op elsewhere. */
  onCost?: (usd: number) => void;
  /** The approval reference authorizing a Ring-3 execution (the janet_pending_approvals
   *  id). Set by /api/janet/approve; the send executor refuses without it. */
  approvalRef?: string | null;
};

/**
 * How a write capability is undone. EVERY state-mutating tool must declare one —
 * "no declaration, no registration" (enforced by scripts/check-tool-contract.mjs,
 * which fails the build). A capability that cannot name its reversal is unfinished.
 *   void                → preserve the row, mark it void (financial/audited records)
 *   soft_delete         → deactivate, keep the row (referenced records)
 *   hard_delete_guarded → real delete, refused when anything references it
 *   compensating        → cannot be undone; a recorded correction is the reversal
 */
export type ToolReversal = 'void' | 'soft_delete' | 'hard_delete_guarded' | 'compensating';

/** One tool in the registry (spec §6). */
export type JanetTool = {
  name: string;
  description: string;               // written FOR the model — precise, includes when to use
  ring: JanetRing;
  input_schema: Record<string, unknown>;  // JSON schema
  handler: (input: unknown, ctx: JanetContext) => Promise<unknown>;
  /** Registered + executable (via /approve) but NOT advertised to the model.
   *  Used by cron-queued proposals (e.g. gated follow-ups) that only ever run
   *  through the approval endpoint, never by the model calling them directly. */
  hidden?: boolean;

  // ── The write contract (Ring 2/3). Enforced by scripts/check-tool-contract.mjs ──
  // Governing principle: NO MODEL BELIEF MAY BE LOAD-BEARING. A capability that
  // writes durable state must not depend on the model remembering whether it ran.
  /** Does this tool write durable state? Ring 2/3 tools MUST declare this. */
  mutates?: boolean;
  /** Required when mutates=true: how this write is undone. */
  reversal?: ToolReversal;
  /** Required when mutates=true: creates route through the write executor
   *  (guardedCreate) — natural-key idempotent + ledgered + read-back. */
  idempotent?: boolean;
};

/** Row shape for janet_actions inserts (append-only audit trail, spec §3). */
export type JanetActionLog = {
  tool_name: string;
  ring: JanetRing;
  input: unknown;
  output_summary?: string | null;
  approved_by_user?: boolean | null; // null for ring 1/2, true/false for ring 3
  status?: 'completed' | 'failed' | 'rejected';
  cost?: number | null;              // estimated USD cost, when known
};
