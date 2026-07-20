// Phase 6.1 — the initiative loop. A scheduled scan of state that produces a
// prioritized worklist of PREPARED DECISIONS: everything already drafted, each a
// concrete executable action (a proposal that runs through the Phase 2 executor on
// approval) with its priority, $ value, and grounded evidence. It FILLS the queue
// unprompted — Blue reviews her instead of prompting her.
//
// Decisions land in janet_pending_approvals (the one approval queue → /approve →
// executor + ledger), so every approved action is provable. Idempotent: a re-run
// never double-queues the same subject.

import { supabaseAdmin } from '../supabase';
import { logJanetAction } from './actions';

export type PreparedDecision = {
  kind: 'initiative';
  priority: number; // higher = surfaced first
  value_estimate: number | null; // $ at stake, when known
  evidence: string; // why this, grounded in a real record
  summary: string; // the header line
  proposals: { tool: string; input: any; summary: string }[]; // the drafted action(s)
  dedup_key: string; // subject identity, so re-runs don't pile up
};

/** Rough $ at stake from a lead's budget tier — for ranking only, never asserted. */
function budgetValue(tier?: string | null): number | null {
  const t = String(tier ?? '').toLowerCase();
  if (/50k\+|\$50|l3/.test(t)) return 50000;
  if (/15k.*50k|l2/.test(t)) return 30000;
  if (/5k.*15k|l1/.test(t)) return 10000;
  if (/<\s*5k|under/.test(t)) return 3000;
  return null; // "not sure yet" etc. — unknown, not zero
}

// ── Prepared-decision generators (one per lane; add more here) ──────────────

/** Inbound leads that JANET has assessed + drafted a reply for → a prepared
 *  send-decision each. Disqualified (fit='pass') leads never get a send. */
async function leadDecisions(): Promise<PreparedDecision[]> {
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, business_name, budget_tier, urgency, problem, ai_analysis, ai_draft_reply')
    .is('deleted_at', null)
    .eq('status', 'new')
    .not('ai_draft_reply', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40);

  const out: PreparedDecision[] = [];
  for (const l of leads ?? []) {
    const fit = (l.ai_analysis as any)?.fit;
    if (fit === 'pass') continue; // disqualified — don't propose a reply
    const urgency = (l.urgency as string) ?? 'cold';
    const priority = urgency === 'hot' ? 100 : urgency === 'warm' ? 60 : 30;
    const who = `${l.name ?? 'lead'}${l.business_name ? ` / ${l.business_name}` : ''}`;
    out.push({
      kind: 'initiative',
      priority,
      value_estimate: budgetValue(l.budget_tier),
      evidence: `New ${urgency} lead — ${who} [${l.budget_tier ?? 'budget ?'}], fit ${fit ?? '?'}. "${String(l.problem ?? '').slice(0, 90)}"`,
      summary: `Reply to ${who} (${urgency}${l.budget_tier ? `, ${l.budget_tier}` : ''})`,
      proposals: [
        {
          tool: 'send_lead_reply',
          input: { lead_id: l.id, subject: 'Re: your note to BLVSTACK', body: l.ai_draft_reply },
          summary: `Send drafted reply to ${who}`,
        },
      ],
      dedup_key: `send_lead_reply:${l.id}`,
    });
  }
  return out;
}

const GENERATORS: (() => Promise<PreparedDecision[]>)[] = [leadDecisions];

/** The dedup key a stored proposal maps to (must match the generators' keys). */
function proposalDedupKey(p: { tool: string; input: any }): string | null {
  if (p?.tool === 'send_lead_reply' && p.input?.lead_id) return `send_lead_reply:${p.input.lead_id}`;
  if (p?.tool === 'send_message_reply' && p.input?.message_id) return `send_message_reply:${p.input.message_id}`;
  return null;
}

/**
 * Fill the morning worklist. Runs every generator, dedups against decisions already
 * pending in the queue, and inserts the fresh prepared decisions (ranked by priority).
 * Returns counts. Safe to run repeatedly (idempotent by subject).
 */
export async function runInitiativeScan(): Promise<{ queued: number; skipped: number; considered: number }> {
  const decisions = (await Promise.all(GENERATORS.map((g) => g().catch(() => [] as PreparedDecision[])))).flat();

  // Already-pending subjects — don't re-queue them.
  const { data: pending } = await supabaseAdmin.from('janet_pending_approvals').select('proposals').eq('status', 'pending');
  const already = new Set<string>();
  for (const row of pending ?? []) {
    for (const p of ((row as any).proposals ?? []) as any[]) {
      const k = proposalDedupKey(p);
      if (k) already.add(k);
    }
  }

  let queued = 0;
  let skipped = 0;
  for (const d of decisions.sort((a, b) => b.priority - a.priority)) {
    if (already.has(d.dedup_key)) { skipped++; continue; }
    const { error } = await supabaseAdmin.from('janet_pending_approvals').insert({
      proposals: d.proposals,
      summary: d.summary,
      status: 'pending',
      kind: d.kind,
      priority: d.priority,
      value_estimate: d.value_estimate,
      evidence: d.evidence,
      page_context: null,
      thread_id: null,
    });
    if (error) { console.error('[initiative] queue insert failed:', error.message); continue; }
    already.add(d.dedup_key);
    queued++;
  }

  await logJanetAction({
    tool_name: 'initiative_scan',
    ring: 2,
    input: { considered: decisions.length },
    status: 'completed',
    output_summary: `Initiative scan: ${queued} prepared decision(s) queued, ${skipped} already pending.`,
  });

  return { queued, skipped, considered: decisions.length };
}
