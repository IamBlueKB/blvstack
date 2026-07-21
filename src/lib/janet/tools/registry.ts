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

import type { JanetContext, JanetTool, JanetRing } from '../types';
import { logJanetAction } from '../actions';
import { localizeTimestamps } from '../time';
import { ring1Tools } from './ring1';
import { ring2Tools } from './ring2';
import { ring2AdminTools } from './ring2-admin';
import { judgmentTools } from './judgment';
import { psrxTools } from './psrx';
import { ring3Tools } from './ring3';
import { auditTools } from './audit-tools';
import { bookerTools } from './booker';
import { threadTools } from './threads';
import { docTools } from './docs';
import { publishTools } from './publish';
import { clearearTools } from './clearear';

export const JANET_TOOLS: JanetTool[] = [
  ...ring1Tools,
  ...ring2Tools,
  ...ring2AdminTools,
  ...judgmentTools,
  ...psrxTools,
  ...auditTools,
  ...bookerTools,
  ...threadTools,
  ...docTools,
  ...publishTools,
  ...clearearTools,
  ...ring3Tools,
];

/** Tools whose structured result should render as a rich audit card (spec §7). */
export const AUDIT_TOOLS = new Set(['run_url_audit', 'run_site_scan']);

export function getJanetTool(name: string): JanetTool | undefined {
  return JANET_TOOLS.find((t) => t.name === name);
}

/** Ring of a tool by name (0 if unknown — server tools like web_search). */
export function ringOf(name: string): JanetRing | 0 {
  return getJanetTool(name)?.ring ?? 0;
}

/**
 * Human-readable one-liner describing a proposed Ring 3 action for the plan
 * card. Content-bearing fields (subject/body) are surfaced by the UI itself;
 * this is the header line.
 */
export function describeProposal(name: string, input: any): string {
  switch (name) {
    case 'send_email':
      return `Send email to ${input?.to ?? 'recipient'}`;
    case 'send_lead_reply':
      return `Send lead reply${input?.subject ? `: ${input.subject}` : ''}`;
    case 'send_message_reply':
      return `Send contact-message reply${input?.subject ? `: ${input.subject}` : ''}`;
    case 'send_outbound_batch':
      return 'Send the queued outbound cold-email batch';
    case 'process_outbound_followups':
      return 'Send due outbound follow-ups';
    case 'send_outbound_followup':
      return `Send follow-up #${input?.follow_up_number ?? '?'}${input?.subject ? `: ${input.subject}` : ''}`;
    case 'booker_send_venue_followup':
      return `Send venue follow-up (match ${input?.match_id ?? '?'})`;
    case 'booker_pitch_venue':
      return `Send pitch to venue (match ${input?.match_id ?? '?'})`;
    case 'booker_send_to_artist':
      return `Email artist their matches (match ${input?.match_id ?? '?'})`;
    case 'booker_send_intake':
      return `Send intake link to artist ${input?.artist_id ?? '?'}`;
    case 'booker_mark_booked':
      return `Confirm booking (match ${input?.match_id ?? '?'}, $${input?.booked_amount ?? '?'})`;
    case 'file_records': {
      const recs = Array.isArray(input?.records) ? input.records : [];
      const lines = recs.map((r: any) => r?.summary ?? r?.action).filter(Boolean);
      return `File ${recs.length} record(s) from the doc${lines.length ? `: ${lines.join('; ')}` : ''}`;
    }
    case 'publish_page':
      return `Publish doc ${input?.doc_id ?? '?'} live at blvstack.com/${input?.slug ?? '?'}${input?.indexable ? ' (indexable)' : ''}`;
    case 'send_clearear_invoice':
      return `Email Clear Ear invoice ${input?.invoice_id ?? '?'} to the client`;
    case 'send_clearear_message':
      return `${input?.invoice_id ? 'Send Clear Ear payment reminder' : 'Send Clear Ear check-in'}${input?.subject ? `: ${input.subject}` : ''}`;
    // Durable-state writes — shown here when taint-escalated (Phase 3.2) so Blue sees
    // exactly what would be written to memory/judgment/suppression before it persists.
    case 'add_memory':
      return `Save memory [${input?.category ?? 'note'}]${input?.content ? `: "${String(input.content).slice(0, 70)}"` : ''}`;
    case 'update_memory':
      return `Edit memory ${input?.id ?? '?'}`;
    case 'deactivate_memory':
      return `Deactivate memory ${input?.id ?? '?'}`;
    case 'record_reasoning_pattern':
      return `Record reasoning pattern${input?.pattern ? `: "${String(input.pattern).slice(0, 70)}"` : ''}`;
    case 'reinforce_pattern':
      return `Reinforce pattern ${input?.id ?? '?'} (${input?.direction ?? '?'})`;
    case 'add_to_graveyard':
      return `Add to graveyard${input?.idea ? `: "${String(input.idea).slice(0, 60)}"` : ''}`;
    case 'add_psrx_suppression':
      return `Suppress PSRx contact${input?.email ? `: ${input.email}` : ''}`;
    default:
      return `Run ${name}`;
  }
}

/** Anthropic API `tools` array built from the registry. */
export function toAnthropicTools(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return JANET_TOOLS.filter((t) => !t.hidden).map(({ name, description, input_schema }) => ({
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
    // Blue's clock, by construction. Every tool result gets "<field>_local"
    // siblings on its timestamps here, once, centrally — so no reader has to
    // remember to convert and no future tool can ship reporting raw UTC. (time.ts)
    const result = localizeTimestamps(await tool.handler(input, ctx));
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
