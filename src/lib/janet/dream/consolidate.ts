// JANET — The Dreaming Phase, Job 2: Consolidate (memory stops silting).
//
// Reads ACTIVE memories against current live data and against each other, and
// proposes: merges (duplicates), deprecations (facts the live data now
// contradicts), promotions (recurring facts worth remembering). The every-turn
// memory injection stays sharp instead of growing into stale noise.
//
// Two tiers, matching the rails:
//   - Exact-duplicate merges are deterministic and AUTO-APPLIED (the only op the
//     rails let a dream apply unsupervised).
//   - Everything else is a MODEL judgment, fed ONLY primary rows (memories +
//     live data), and lands as a review-gated proposal with provenance. The
//     model never sees prior dream output — Rail 1, enforced by what we pass in
//     and by createProposal's provenance gate.

import { supabaseAdmin } from '../../supabase';
import { createProposal, type ProvRef } from './proposals';
import { dreamComplete, parseDreamJson } from './model';

export interface ConsolidateSummary {
  dream_run_at: string;
  memories_scanned: number;
  auto_merged: number;
  proposed: { merge: number; deprecate: number; promote: number };
  proposal_ids: string[];
  // 'ok' = the model pass finished (proposed counts are real, zero means nothing found).
  // 'incomplete' = the model pass did NOT finish (batch timed out / budget / unreadable);
  // proposed counts are unknown, NOT zero. Exact-dup merges (deterministic) still applied.
  status: 'ok' | 'incomplete';
  note?: string;
}

type Memory = { id: string; category: string; content: string; source: string | null; created_at: string };

/** Normalize memory content for EXACT-duplicate detection: case, whitespace,
 *  trailing punctuation. Same category + same normalized content = exact dup. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

export async function runConsolidate(dreamRunAt?: string): Promise<ConsolidateSummary> {
  const dream_run_at = dreamRunAt ?? new Date().toISOString();
  const summary: ConsolidateSummary = {
    dream_run_at,
    memories_scanned: 0,
    auto_merged: 0,
    proposed: { merge: 0, deprecate: 0, promote: 0 },
    proposal_ids: [],
    status: 'ok',
  };

  const { data: mems } = await supabaseAdmin
    .from('janet_memory')
    .select('id, category, content, source, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true });
  const memories = (mems ?? []) as Memory[];
  summary.memories_scanned = memories.length;
  if (memories.length === 0) return summary;

  // ── Tier 1: exact-duplicate merges (deterministic, auto-applied) ────────────
  const groups = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = `${m.category}${normalize(m.content)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const mergedAway = new Set<string>(); // ids removed from the live set this run
  for (const grp of groups.values()) {
    if (grp.length < 2) continue;
    const [keeper, ...dups] = grp; // earliest created_at is the canonical keeper
    const proposal = await createProposal({
      dream_run_at,
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
    summary.auto_merged++;
    summary.proposal_ids.push(proposal.id);
    for (const d of dups) mergedAway.add(d.id);
  }

  // Remaining live memories after exact-dup removal — the set the model reasons over.
  const live = memories.filter((m) => !mergedAway.has(m.id));

  // ── Tier 2: model-judgment proposals (review-gated) ─────────────────────────
  // Assemble ONLY primary rows: the live memories + a compact current-state digest.
  const digest = await liveDigest();
  const memoryList = live.map((m) => `- id=${m.id} [${m.category}] ${m.content} (learned ${m.created_at.slice(0, 10)})`).join('\n');
  const liveIds = new Set(live.map((m) => m.id));

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

  let items: any[] = [];
  try {
    const { text } = await dreamComplete(system, user, 1800);
    const parsed = parseDreamJson<any[]>(text);
    if (Array.isArray(parsed)) {
      items = parsed;
    } else {
      // The batch FINISHED but the output was unreadable — that is "did not produce
      // usable output", not "nothing to merge". Record it as incomplete, honestly.
      summary.status = 'incomplete';
      summary.note = 'model output was unreadable';
      return summary;
    }
  } catch (e) {
    // The model pass did NOT finish (batch timeout / budget / batch error). The
    // exact-dup merges above are real; the near-dup/deprecate/promote pass is
    // incomplete — reported as such, NEVER as zero proposals.
    summary.status = 'incomplete';
    summary.note = (e as Error).name === 'DreamIncompleteError' ? (e as Error).message : `model pass errored: ${(e as Error).message}`;
    console.error('[dream] consolidate model pass incomplete:', summary.note);
    return summary;
  }

  for (const it of items) {
    const kind: 'merge' | 'deprecate' | 'promote' | undefined = it?.kind;
    if (kind !== 'merge' && kind !== 'deprecate' && kind !== 'promote') continue;
    const summaryText = typeof it.summary === 'string' && it.summary.trim() ? it.summary.trim() : `${kind} proposal`;
    // Validate cited provenance against the primary rows we actually provided.
    const cites: ProvRef[] = Array.isArray(it.cite) ? it.cite.filter((c: any) => c && typeof c.table === 'string' && typeof c.id === 'string') : [];
    const validCites = cites.filter((c) => (c.table === 'janet_memory' ? liveIds.has(c.id) : digest.ids.has(c.id)));
    // Also fold memory_id / related_memory_id into provenance when the model used those fields.
    for (const key of ['memory_id', 'related_memory_id']) {
      const v = it[key];
      if (typeof v === 'string' && liveIds.has(v) && !validCites.some((c) => c.id === v)) validCites.push({ table: 'janet_memory', id: v });
    }
    if (validCites.length === 0) continue; // Rail 1: no valid primary provenance -> drop it, don't fabricate

    let target_id: string | null = null;
    let payload: Record<string, unknown> = {};
    if (kind === 'deprecate') {
      target_id = typeof it.memory_id === 'string' && liveIds.has(it.memory_id) ? it.memory_id : (validCites.find((c) => c.table === 'janet_memory')?.id ?? null);
      if (!target_id) continue;
    } else if (kind === 'merge') {
      const ids = validCites.filter((c) => c.table === 'janet_memory').map((c) => c.id);
      if (ids.length < 2) continue; // a merge needs two real memories
      const keep = ids[0], drop = ids.slice(1);
      target_id = keep;
      payload = { keep_id: keep, deactivate_ids: drop };
    } else if (kind === 'promote') {
      const content = typeof it.content === 'string' && it.content.trim() ? it.content.trim() : summaryText;
      payload = { content, category: typeof it.category === 'string' ? it.category : 'fact', source: `dream promote ${dream_run_at.slice(0, 10)}` };
    }

    const proposal = await createProposal({
      dream_run_at,
      job: 'consolidate',
      kind,
      summary: summaryText,
      rationale: typeof it.rationale === 'string' ? it.rationale : null,
      target_table: kind === 'promote' ? 'janet_memory' : 'janet_memory',
      target_id,
      payload,
      provenance: validCites,
      auto_apply: false, // Rail 2: only exact-dup merges auto-apply; these wait for Blue
    });
    summary.proposed[kind]++;
    summary.proposal_ids.push(proposal.id);
  }

  return summary;
}

/** A compact snapshot of current live business state — primary rows the model
 *  reasons against for deprecations/promotions. Each row carries its id so a
 *  proposal can cite it as provenance. */
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
