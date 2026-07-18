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

/** One tool in the registry (spec §6). */
export type JanetTool = {
  name: string;
  description: string;               // written FOR the model — precise, includes when to use
  ring: JanetRing;
  input_schema: Record<string, unknown>;  // JSON schema
  handler: (input: unknown, ctx: JanetContext) => Promise<unknown>;
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
