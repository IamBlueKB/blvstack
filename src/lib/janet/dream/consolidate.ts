// JANET — The Dreaming Phase, Job 2: Consolidate (memory stops silting).
//
// Two-phase: prepareConsolidate() runs at NIGHT (gather, apply the deterministic
// exact-duplicate merges, submit the model batch) and finalizeConsolidate() runs
// in the COLLECTOR (validate the returned candidates against the SUBMIT-TIME
// snapshot and land them as review-gated proposals).
//
// Rails unchanged:
//   - Exact-duplicate merges are deterministic and AUTO-APPLIED at night (the only
//     op the rails let a dream apply unsupervised).
//   - Everything else is a MODEL judgment, fed ONLY primary rows, and validated at
//     collect against the ids the model actually saw — the persisted snapshot,
//     NEVER a re-fetch (a re-fetch drifts; a proposal could then cite a memory the
//     model never saw). This is load-bearing.

import { supabaseAdmin } from '../../supabase';
import { createProposal, type ProvRef } from './proposals';
import { submitDreamBatch, parseDreamJson } from './model';
import type { ConsolidateFacts } from './pure';

/** What the night persists so the collector can finalize deterministically. The
 *  id lists ARE the provenance snapshot — validation keys on them, never a re-read. */
export interface ConsolidatePending {
  status: 'submitted' | 'skipped_no_input';
  batch_id?: string;
  live_memory_ids: string[]; // memory ids the model saw (after exact-dup removal)
  digest_ids: string[]; // live-row ids the model saw
  auto_merged: number; // exact-dup merges applied at night
  proposal_ids: string[]; // ids of those auto-merge proposals
  memories_scanned: number;
  note?: string;
}

type Memory = { id: string; category: string; content: string; source: string | null; created_at: string };

/** Normalize memory content for EXACT-duplicate detection. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

/** NIGHT: gather memories, apply exact-dup merges, build the prompt, submit the
 *  batch. Returns the snapshot to persist. Does NOT poll. */
export async function prepareConsolidate(dreamRunAt: string): Promise<ConsolidatePending> {
  const { data: mems } = await supabaseAdmin
    .from('janet_memory')
    .select('id, category, content, source, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true });
  const memories = (mems ?? []) as Memory[];
  if (memories.length === 0) {
    return {
      status: 'skipped_no_input',
      live_memory_ids: [],
      digest_ids: [],
      auto_merged: 0,
      proposal_ids: [],
      memories_scanned: 0,
      note: 'no active memories to consolidate — no model call was made',
    };
  }

  // ── Tier 1: exact-duplicate merges (deterministic, auto-applied at night) ────
  const groups = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = `${m.category}${normalize(m.content)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const mergedAway = new Set<string>();
  let auto_merged = 0;
  const proposal_ids: string[] = [];
  for (const grp of groups.values()) {
    if (grp.length < 2) continue;
    const [keeper, ...dups] = grp;
    const proposal = await createProposal({
      dream_run_at: dreamRunAt,
      job: 'consolidate',
      kind: 'merge',
      summary: `Merge ${dups.length} exact-duplicate memory${dups.length > 1 ? 'ies' : 'y'} under [${keeper.category}]`,
      rationale: `Identical content; keeping the earliest (learned ${keeper.created_at.slice(0, 10)}) and deactivating the ${dups.length} duplicate(s).`,
      target_table: 'janet_memory',
      target_id: keeper.id,
      payload: { keep_id: keeper.id, deactivate_ids: dups.map((d) => d.id) },
      provenance: grp.map((m) => ({ table: 'janet_memory', id: m.id }) as ProvRef),
      auto_apply: true,
    });
    auto_merged++;
    proposal_ids.push(proposal.id);
    for (const d of dups) mergedAway.add(d.id);
  }

  // Remaining live memories — the set the model reasons over (and validates against).
  const live = memories.filter((m) => !mergedAway.has(m.id));
  const digest = await liveDigest();
  const memoryList = live.map((m) => `- id=${m.id} [${m.category}] ${m.content} (learned ${m.created_at.slice(0, 10)})`).join('\n');

  const system = [
    'You are JANET reviewing her OWN long-term memory for hygiene, overnight. You are given her active memories and a snapshot of current live business data.',
    'Propose ONLY changes grounded in the data you are given. Never invent a fact. If nothing needs changing, return an empty array.',
    'Three kinds of proposal:',
    '- "merge": two memories that say the SAME thing in different words (near-duplicates). Cite both memory ids.',
    '- "deprecate": a memory the CURRENT live data now contradicts or makes obsolete (e.g. a stale metric, a deal state that changed). Cite the memory id; explain what in the live data contradicts it.',
    '- "promote": a fact clearly present in the live data that recurs and is worth remembering, and is NOT already covered by an existing memory. Cite the live rows it comes from.',
    'Every proposal MUST cite the exact id(s) it is based on, from the data provided — memory ids or live-row ids. Do not cite anything not shown.',
    'Output ONLY a JSON array. Each item: {"kind","summary","rationale","memory_id"?,"related_memory_id"?,"content"?,"category"?,"cite":[{"table","id"}]}.',
    'Be conservative: propose only what the data clearly supports. Deprecate needs a real contradiction, not a hunch.',
  ].join('\n');
  const user = `ACTIVE MEMORIES:\n${memoryList || '(none)'}\n\nCURRENT LIVE DATA (primary rows):\n${digest.text || '(none)'}`;

  const { batchId } = await submitDreamBatch(system, user, 1800);

  return {
    status: 'submitted',
    batch_id: batchId,
    live_memory_ids: live.map((m) => m.id),
    digest_ids: [...digest.ids],
    auto_merged,
    proposal_ids,
    memories_scanned: memories.length,
  };
}

/** COLLECT: given the parsed model output (or null if unreadable/never-ran) and
 *  the persisted snapshot, land the review-gated proposals and return the facts.
 *  Provenance is validated against the snapshot ids ONLY — never a re-fetch. */
export async function finalizeConsolidate(parsed: any[] | null, pending: ConsolidatePending, dreamRunAt: string): Promise<ConsolidateFacts> {
  const facts: ConsolidateFacts = { status: 'ok', auto_merged: pending.auto_merged ?? 0, proposed: { merge: 0, deprecate: 0, promote: 0 } };

  if (pending.status === 'skipped_no_input') {
    facts.status = 'skipped_no_input';
    facts.note = pending.note ?? 'no active memories to consolidate';
    return facts;
  }
  if (parsed === null) {
    facts.status = 'incomplete';
    facts.note = 'model output was unreadable';
    return facts;
  }

  const liveIds = new Set(pending.live_memory_ids);
  const digestIds = new Set(pending.digest_ids);

  for (const it of parsed) {
    const kind: 'merge' | 'deprecate' | 'promote' | undefined = it?.kind;
    if (kind !== 'merge' && kind !== 'deprecate' && kind !== 'promote') continue;
    const summaryText = typeof it.summary === 'string' && it.summary.trim() ? it.summary.trim() : `${kind} proposal`;
    const cites: ProvRef[] = Array.isArray(it.cite) ? it.cite.filter((c: any) => c && typeof c.table === 'string' && typeof c.id === 'string') : [];
    // Validate against the SUBMIT-TIME snapshot ids only.
    const validCites = cites.filter((c) => (c.table === 'janet_memory' ? liveIds.has(c.id) : digestIds.has(c.id)));
    for (const key of ['memory_id', 'related_memory_id']) {
      const v = it[key];
      if (typeof v === 'string' && liveIds.has(v) && !validCites.some((c) => c.id === v)) validCites.push({ table: 'janet_memory', id: v });
    }
    if (validCites.length === 0) continue; // Rail 1: no valid primary provenance -> drop

    let target_id: string | null = null;
    let payload: Record<string, unknown> = {};
    if (kind === 'deprecate') {
      target_id = typeof it.memory_id === 'string' && liveIds.has(it.memory_id) ? it.memory_id : (validCites.find((c) => c.table === 'janet_memory')?.id ?? null);
      if (!target_id) continue;
    } else if (kind === 'merge') {
      const ids = validCites.filter((c) => c.table === 'janet_memory').map((c) => c.id);
      if (ids.length < 2) continue;
      const keep = ids[0], drop = ids.slice(1);
      target_id = keep;
      payload = { keep_id: keep, deactivate_ids: drop };
    } else if (kind === 'promote') {
      const content = typeof it.content === 'string' && it.content.trim() ? it.content.trim() : summaryText;
      payload = { content, category: typeof it.category === 'string' ? it.category : 'fact', source: `dream promote ${dreamRunAt.slice(0, 10)}` };
    }

    await createProposal({
      dream_run_at: dreamRunAt,
      job: 'consolidate',
      kind,
      summary: summaryText,
      rationale: typeof it.rationale === 'string' ? it.rationale : null,
      target_table: 'janet_memory',
      target_id,
      payload,
      provenance: validCites,
      auto_apply: false, // Rail 2
    });
    facts.proposed[kind]++;
  }

  return facts;
}

/** A compact snapshot of current live business state — primary rows the model
 *  reasons against. Each row carries its id so a proposal can cite it. */
async function liveDigest(): Promise<{ text: string; ids: Set<string> }> {
  const ids = new Set<string>();
  const lines: string[] = [];
  const [deals, clients, sites] = await Promise.all([
    supabaseAdmin.from('janet_deals').select('id, name, stage, outcome, value_estimate').order('updated_at', { ascending: false }).limit(40),
    supabaseAdmin.from('janet_clients').select('id, name, status').limit(40),
    supabaseAdmin.from('connected_sites').select('id, domain, status').limit(40),
  ]);
  for (const d of deals.data ?? []) { ids.add(d.id); lines.push(`- deal id=${d.id} "${(d as any).name}" stage=${(d as any).stage}${(d as any).outcome ? ` outcome=${(d as any).outcome}` : ''}${(d as any).value_estimate ? ` $${(d as any).value_estimate}` : ''}`); }
  for (const c of clients.data ?? []) { ids.add(c.id); lines.push(`- client id=${c.id} "${(c as any).name}" status=${(c as any).status}`); }
  for (const s of sites.data ?? []) { ids.add(s.id); lines.push(`- site id=${s.id} ${(s as any).domain} status=${(s as any).status}`); }
  return { text: lines.join('\n'), ids };
}
