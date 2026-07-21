// JANET — The Dreaming Phase, D2: the proposal store helpers.
//
// Every dream proposal is created here, and every accept/reject flows through
// here. Two rails are enforced in code, not just documented:
//
//   Rail 1 — provenance points at PRIMARY rows only. A proposal MUST cite at
//   least one source row, and none of those sources may be another
//   janet_dream_proposals row. Dreams consolidate from source records, never
//   from prior dream output (anti-self-hypnosis).
//
//   Rail 2 — propose, don't rewrite. Only exact-duplicate merges are created
//   auto_applied; everything else is 'proposed' and waits for Blue. The actual
//   durable change runs through executeProposalChange(), the SAME code path for
//   an auto-apply and for a later accept, so there is one apply implementation.
//
//   Rail 3 — Ring 1/2 only. Every change here touches internal, reversible
//   state (janet_memory's active flag, or an internal insert). Nothing external.

import { supabaseAdmin } from '../../supabase';
import { logJanetAction } from '../actions';

/** Tables a proposal may NEVER cite as a source (Rail 1). */
const PROVENANCE_DENY = new Set(['janet_dream_proposals']);

export type ProvRef = { table: string; id: string };
export type DreamJob = 'consolidate' | 'synthesize';
export type DreamKind = 'merge' | 'deprecate' | 'promote' | 'pattern' | 'graveyard' | 'strategy';

export interface CreateProposalInput {
  dream_run_at: string;
  job: DreamJob;
  kind: DreamKind;
  summary: string;
  rationale?: string;
  target_table?: string | null;
  target_id?: string | null;
  payload?: Record<string, unknown>;
  provenance: ProvRef[];
  auto_apply?: boolean;
}

export interface DreamProposal {
  id: string;
  dream_run_at: string;
  job: DreamJob;
  kind: DreamKind;
  summary: string;
  rationale: string | null;
  target_table: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  provenance: ProvRef[];
  status: 'proposed' | 'accepted' | 'rejected' | 'auto_applied';
  auto_apply: boolean;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** Rail 1 gate: reject a proposal with no provenance or with a forbidden source. */
function assertProvenance(provenance: ProvRef[]): void {
  if (!Array.isArray(provenance) || provenance.length === 0) {
    throw new Error('Dream proposal rejected: provenance is required (must cite the primary rows it is based on).');
  }
  for (const p of provenance) {
    if (!p || typeof p.table !== 'string' || typeof p.id !== 'string' || !p.table || !p.id) {
      throw new Error('Dream proposal rejected: each provenance entry needs {table, id}.');
    }
    if (PROVENANCE_DENY.has(p.table)) {
      throw new Error(`Dream proposal rejected: cannot consolidate from ${p.table} — dreams read primary records, never prior dream output (Rail 1).`);
    }
  }
}

/**
 * Create a proposal. If auto_apply is set (exact-duplicate merges only), the
 * change is executed immediately and the row is stored 'auto_applied'; otherwise
 * it is stored 'proposed' and waits for Blue.
 */
export async function createProposal(input: CreateProposalInput): Promise<DreamProposal> {
  assertProvenance(input.provenance);
  const auto = input.auto_apply === true;
  const row = {
    dream_run_at: input.dream_run_at,
    job: input.job,
    kind: input.kind,
    summary: input.summary,
    rationale: input.rationale ?? null,
    target_table: input.target_table ?? null,
    target_id: input.target_id ?? null,
    payload: input.payload ?? {},
    provenance: input.provenance,
    status: auto ? 'auto_applied' : 'proposed',
    auto_apply: auto,
  };
  const { data, error } = await supabaseAdmin.from('janet_dream_proposals').insert(row).select().single();
  if (error) throw new Error(`createProposal failed: ${error.message}`);
  const proposal = data as DreamProposal;
  if (auto) {
    await executeProposalChange(proposal);
    await logJanetAction({
      tool_name: 'dream_auto_apply',
      ring: 2,
      input: { proposal_id: proposal.id, kind: proposal.kind },
      approved_by_user: null,
      status: 'completed',
      output_summary: `Auto-applied: ${proposal.summary}`,
    });
  }
  return proposal;
}

/**
 * Execute a proposal's durable change. The ONE apply path — used by auto-apply
 * at creation and by accept() later. Only memory-hygiene kinds (D2) are handled;
 * synthesize kinds (D3) extend this switch. Everything is reversible internal state.
 */
async function executeProposalChange(p: DreamProposal): Promise<void> {
  switch (p.kind) {
    case 'merge': {
      // Keep one memory, deactivate the exact duplicates. Reversible (active flag).
      const ids = (p.payload?.deactivate_ids as string[] | undefined) ?? [];
      if (ids.length) {
        const { error } = await supabaseAdmin
          .from('janet_memory')
          .update({ active: false, updated_at: new Date().toISOString() })
          .in('id', ids);
        if (error) throw new Error(`merge apply failed: ${error.message}`);
      }
      break;
    }
    case 'deprecate': {
      // A memory the live data now contradicts — deactivate it (reversible).
      if (p.target_table === 'janet_memory' && p.target_id) {
        const { error } = await supabaseAdmin
          .from('janet_memory')
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq('id', p.target_id);
        if (error) throw new Error(`deprecate apply failed: ${error.message}`);
      }
      break;
    }
    case 'promote': {
      // A recurring fact worth remembering — insert a new active memory.
      const category = (p.payload?.category as string) || 'fact';
      const content = (p.payload?.content as string) || p.summary;
      const source = (p.payload?.source as string) || `dream promote ${p.dream_run_at.slice(0, 10)}`;
      const { error } = await supabaseAdmin.from('janet_memory').insert({ category, content, source, active: true });
      if (error) throw new Error(`promote apply failed: ${error.message}`);
      break;
    }
    default:
      throw new Error(`executeProposalChange: kind "${p.kind}" is not applicable in D2 (synthesize kinds land in D3).`);
  }
}

/** Accept a proposed change: execute it, then mark accepted. Idempotent. */
export async function acceptProposal(id: string, by: string): Promise<{ ok: boolean; already?: boolean }> {
  const { data } = await supabaseAdmin.from('janet_dream_proposals').select('*').eq('id', id).maybeSingle();
  if (!data) throw new Error('Proposal not found');
  const p = data as DreamProposal;
  if (p.status !== 'proposed') return { ok: true, already: true }; // idempotent
  await executeProposalChange(p);
  await supabaseAdmin
    .from('janet_dream_proposals')
    .update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: by })
    .eq('id', id);
  await logJanetAction({
    tool_name: 'dream_accept',
    ring: 2,
    input: { proposal_id: id, kind: p.kind },
    approved_by_user: true,
    status: 'completed',
    output_summary: `Accepted: ${p.summary}`,
  });
  return { ok: true };
}

/** Reject a proposed change: no state touched, just mark rejected. Idempotent. */
export async function rejectProposal(id: string, by: string): Promise<{ ok: boolean; already?: boolean }> {
  const { data } = await supabaseAdmin.from('janet_dream_proposals').select('status').eq('id', id).maybeSingle();
  if (!data) throw new Error('Proposal not found');
  if ((data as any).status !== 'proposed') return { ok: true, already: true };
  await supabaseAdmin
    .from('janet_dream_proposals')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: by })
    .eq('id', id);
  return { ok: true };
}

/** The proposals from a given run (the night's dream journal), for the brief (D4). */
export async function listProposals(dreamRunAt?: string): Promise<DreamProposal[]> {
  let q = supabaseAdmin.from('janet_dream_proposals').select('*').order('created_at', { ascending: false });
  if (dreamRunAt) q = q.eq('dream_run_at', dreamRunAt);
  const { data } = await q;
  return (data ?? []) as DreamProposal[];
}
