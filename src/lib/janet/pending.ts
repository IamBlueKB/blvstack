// Helpers for cron-gated follow-ups (Phase 2.1, option A). The follow-up crons
// no longer auto-send — they DRAFT a proposal into janet_pending_approvals for
// one-click review. Blue's approval routes it through /api/janet/approve →
// executeJanetTool → the send executor (the ONE gated path). These helpers
// insert those proposals and dedup against ones already queued, so a follow-up
// isn't piled up twice when the cron runs again before Blue has acted.

import { supabaseAdmin } from '../supabase';

export type PendingProposal = { tool: string; input: Record<string, unknown>; summary: string };

/** Insert a pending approval (status defaults to 'pending'). Not thread-scoped —
 *  it's a system-initiated draft, surfaced in the panel's pending list. */
export async function queuePendingApproval(proposal: PendingProposal): Promise<void> {
  await supabaseAdmin.from('janet_pending_approvals').insert({
    proposals: [proposal],
    summary: proposal.summary,
    page_context: null,
    thread_id: null,
  });
}

/** The set of input-key values already sitting in a PENDING approval for a given
 *  tool (e.g. every prospect_id already queued for send_outbound_followup), so a
 *  follow-up isn't queued twice across cron runs. */
export async function queuedProposalKeys(tool: string, inputKey: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('janet_pending_approvals')
    .select('proposals')
    .eq('status', 'pending');
  const keys = new Set<string>();
  for (const row of data ?? []) {
    for (const p of ((row as any).proposals ?? []) as any[]) {
      const v = p?.tool === tool ? p?.input?.[inputKey] : undefined;
      if (v != null) keys.add(String(v));
    }
  }
  return keys;
}
