/** Shared thread model for the JANET panel — one thread, two presentations
 *  (docked command stream + expanded spatial canvas). */

/** A Ring 3 action JANET proposes; Blue approves before it runs (spec §4.4). */
export type JanetProposal = { tool: string; input: any; summary: string };
export type PlanOutcome = { tool: string; ok: boolean; summary: string };
export type PlanStatus = 'pending' | 'working' | 'approved' | 'rejected';

export type ThreadItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; status: 'running' | 'done'; ok?: boolean; summary?: string }
  | { kind: 'plan'; proposals: JanetProposal[]; status: PlanStatus; outcomes?: PlanOutcome[]; approval_id?: string | null }
  | { kind: 'audit'; tool: string; result: any }
  | { kind: 'error'; text: string };
