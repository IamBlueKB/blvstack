// JANET v1 — tool registry (spec §6)
//
// Single source of truth mapping tools → handlers → rings. Ring assignments
// live HERE so promoting an action between rings is a deliberate config
// change, not a prompt tweak. Tools are added per build phase:
//   Phase 2 — Ring 1 read tools
//   Phase 4 — Ring 2 internal-act tools + Ring 3 send_email
//   Phase 5 — audit engine tools
//
// executeJanetTool is the ONLY path the brain uses to run a tool. It
// enforces ring semantics and writes the audit trail:
//   Ring 1 — execute; log only on failure
//   Ring 2 — execute; always log
//   Ring 3 — refuse unless the call carries an explicit approval flag from
//            the approval endpoint; always log with the approval outcome

import type { JanetContext, JanetTool } from '../types';
import { logJanetAction } from '../actions';

export const JANET_TOOLS: JanetTool[] = [
  // Populated in Phase 2+ — registry intentionally empty in Phase 1.
];

export function getJanetTool(name: string): JanetTool | undefined {
  return JANET_TOOLS.find((t) => t.name === name);
}

/** Anthropic API `tools` array built from the registry. */
export function toAnthropicTools(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return JANET_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}

export type ToolExecutionResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export async function executeJanetTool(
  name: string,
  input: unknown,
  ctx: JanetContext,
  opts?: { approvedByUser?: boolean }
): Promise<ToolExecutionResult> {
  const tool = getJanetTool(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

  // Ring 3 without explicit approval never executes (spec §2 — no exceptions in v1).
  if (tool.ring === 3 && opts?.approvedByUser !== true) {
    await logJanetAction({
      tool_name: name,
      ring: tool.ring,
      input,
      approved_by_user: opts?.approvedByUser ?? null,
      status: 'rejected',
      output_summary: 'Blocked: Ring 3 tool called without user approval',
    });
    return { ok: false, error: 'Ring 3 action requires explicit user approval before execution.' };
  }

  try {
    const result = await tool.handler(input, ctx);
    if (tool.ring >= 2) {
      await logJanetAction({
        tool_name: name,
        ring: tool.ring,
        input,
        approved_by_user: tool.ring === 3 ? true : null,
        status: 'completed',
        output_summary: summarize(result),
      });
    }
    return { ok: true, result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logJanetAction({
      tool_name: name,
      ring: tool.ring,
      input,
      approved_by_user: tool.ring === 3 ? true : null,
      status: 'failed',
      output_summary: message.slice(0, 500),
    });
    return { ok: false, error: message };
  }
}

function summarize(result: unknown): string {
  if (result == null) return 'ok (no output)';
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}
