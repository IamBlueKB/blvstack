// JANET v1 — system prompt composition (spec §5.2)
//
// Built fresh per request:
//   1. Identity + rules (static)
//   2. Business snapshot (live queries, kept compact — target < ~2K tokens)
//   3. Memory (all active janet_memory entries, grouped by category)
//   4. Page context (where Blue is right now)
// Tool definitions and conversation history are handled by brain.ts.

import { supabaseAdmin } from '../supabase';
import type { PageContext } from './types';

const IDENTITY = `You are JANET (Judgment-Augmented Network for Execution & Triage), BLVSTACK's internal operator. You work for Blue, BLVSTACK's founder. You are internal-only — no client or visitor ever sees you. Your job is to help Blue run and grow BLVSTACK: network-driven site builds, converting delivered builds into monitoring/maintenance retainers (MRR), and keeping the deal pipeline healthy.

AUTHORITY MODEL — three rings, enforced in code:
- Ring 1 (read): you read anything, any time, without asking.
- Ring 2 (internal act): reversible writes inside BLVSTACK's systems. You act without per-action approval, but every action is logged to an audit trail you cannot write to.
- Ring 3 (external/irreversible): sending anything to a real person, touching a live client site, deleting data, anything involving money. You draft and present; Blue approves; then it executes. No exceptions. IMPORTANT: your Ring 3 tools — send_email, booker_pitch_venue (send a pitch to a venue), booker_send_to_artist (email an artist their matches), booker_send_intake (email an artist their intake link), booker_mark_booked (confirm a booking + payment) — do NOT fire when you call them; they surface the action to Blue as an approve/adjust/reject card. When Blue asks you to send, pitch, email, or book, CALL the matching tool with the details — do not just describe the action in text and stop, or the approval card never appears.

OPERATING RULES:
- Plan-approve-execute on every consequential action. For multi-step work, state the plan and wait for Blue's go-ahead before executing.
- Evidence over vibes. Every claim cites a metric, a record, or an observation. Never "this feels slow" — always "LCP is 3.8s, threshold is 2.5s." If you don't have the data, say so and offer to get it.
- Never fabricate. If a lookup returns nothing, report that it returned nothing.
- You grow by remembering, not by rewriting yourself. When Blue corrects you or states a preference, record it with the add_memory tool (category preference/pricing/playbook/correction/fact) — do this reliably; it's how you persist across sessions. You can also act inside BLVSTACK with your Ring 2 tools: create_deal, update_deal, create_site, draft_email, draft_proposal.

SUGGESTIONS:
- Proactively suggest when the data supports it: stalled deals, delivered sites with no retainer pitched, audit findings worth acting on, referral-timing moments, patterns across deals.
- Every suggestion cites its evidence. Suggestions are offers, never nagging. Never repeat a suggestion Blue dismissed.

TONE: concise, direct, competent. No emojis. No exclamation points. No filler ("Great question", "I'd be happy to"). Plain text — no markdown headers unless presenting structured data. Answer first, detail after.`;

/** Compact live business snapshot. Failures degrade to a note, never throw. */
export async function buildBusinessSnapshot(): Promise<string> {
  try {
    const [dealsRes, sitesRes, scansRes, prospectsRes, repliesRes, briefingRes] =
      await Promise.all([
        supabaseAdmin
          .from('janet_deals')
          .select('name, stage, value_estimate, next_action, next_action_due, updated_at')
          .not('stage', 'in', '(lost,delivered)')
          .order('updated_at', { ascending: false })
          .limit(10),
        supabaseAdmin
          .from('janet_sites')
          .select('id, name, production_url, status, retainer_status, retainer_monthly')
          .neq('status', 'archived')
          .limit(10),
        supabaseAdmin
          .from('janet_site_scans')
          .select('site_id, scan_type, passed, failed, score, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
        supabaseAdmin.from('prospects').select('status').limit(1000),
        supabaseAdmin
          .from('prospects')
          .select('company_name, replied_at')
          .eq('status', 'replied')
          .order('replied_at', { ascending: false })
          .limit(5),
        supabaseAdmin
          .from('janet_briefings')
          .select('briefing_date')
          .is('read_at', null)
          .order('briefing_date', { ascending: false })
          .limit(1),
      ]);

    const lines: string[] = [`Date: ${new Date().toISOString().slice(0, 10)}`];

    const deals = dealsRes.data ?? [];
    lines.push(`\nOPEN DEALS (${deals.length}):`);
    if (deals.length === 0) lines.push('- none in pipeline');
    for (const d of deals) {
      const due = d.next_action_due ? ` due ${d.next_action_due}` : '';
      const val = d.value_estimate ? ` ~$${Number(d.value_estimate).toLocaleString()}` : '';
      lines.push(`- ${d.name} [${d.stage}]${val}${d.next_action ? ` — next: ${d.next_action}${due}` : ''}`);
    }

    const sites = sitesRes.data ?? [];
    const latestScanBySite = new Map<string, any>();
    for (const s of scansRes.data ?? []) {
      if (!latestScanBySite.has(s.site_id)) latestScanBySite.set(s.site_id, s);
    }
    lines.push(`\nSITES (${sites.length}):`);
    if (sites.length === 0) lines.push('- none connected yet');
    for (const s of sites) {
      const scan = latestScanBySite.get(s.id);
      const scanNote = scan
        ? `last ${scan.scan_type ?? 'scan'} ${scan.created_at.slice(0, 10)}: score ${scan.score ?? '?'} (${scan.passed ?? '?'} passed / ${scan.failed ?? '?'} failed)`
        : 'never scanned';
      const retainer =
        s.retainer_status === 'active'
          ? `retainer $${Number(s.retainer_monthly ?? 0).toLocaleString()}/mo`
          : `retainer: ${s.retainer_status ?? 'none'}`;
      lines.push(`- ${s.name} (${s.production_url}) [${s.status}] — ${retainer} — ${scanNote}`);
    }

    const statusCounts: Record<string, number> = {};
    for (const p of prospectsRes.data ?? []) {
      statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
    }
    const countsStr = Object.entries(statusCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    lines.push(`\nOUTBOUND PROSPECTS: ${countsStr || 'none'}`);

    const replies = repliesRes.data ?? [];
    if (replies.length > 0) {
      lines.push(
        `Recent replies: ${replies.map((r) => `${r.company_name} (${r.replied_at?.slice(0, 10)})`).join(', ')}`
      );
    }

    if ((briefingRes.data ?? []).length > 0) {
      lines.push(`\nUnread briefing waiting: ${briefingRes.data![0].briefing_date}`);
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[janet] snapshot failed:', err);
    return 'Business snapshot unavailable (query failed) — use Ring 1 tools to read current state.';
  }
}

/** All active memory entries, grouped by category. */
export async function loadActiveMemory(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('janet_memory')
      .select('category, content')
      .eq('active', true)
      .order('category')
      .order('created_at');
    if (!data || data.length === 0) return 'No memories recorded yet.';
    const byCategory = new Map<string, string[]>();
    for (const m of data) {
      if (!byCategory.has(m.category)) byCategory.set(m.category, []);
      byCategory.get(m.category)!.push(m.content);
    }
    const out: string[] = [];
    for (const [cat, items] of byCategory) {
      out.push(`[${cat}]`);
      for (const item of items) out.push(`- ${item}`);
    }
    return out.join('\n');
  } catch (err) {
    console.error('[janet] memory load failed:', err);
    return 'Memory unavailable (query failed).';
  }
}

export async function buildJanetSystemPrompt(
  pageContext?: PageContext | null
): Promise<string> {
  const [snapshot, memory] = await Promise.all([buildBusinessSnapshot(), loadActiveMemory()]);

  const contextSection = pageContext
    ? `\n\nWHERE BLUE IS RIGHT NOW:\nPage: ${pageContext.path}${
        pageContext.entity_type ? `\nOpen record: ${pageContext.entity_type} ${pageContext.entity_id ?? ''}` : ''
      }${
        pageContext.entity_summary
          ? `\nRecord summary: ${JSON.stringify(pageContext.entity_summary)}`
          : ''
      }\nWhen Blue says "this one" or similar, they mean the open record.`
    : '';

  return `${IDENTITY}

BUSINESS SNAPSHOT (live as of this message):
${snapshot}

MEMORY (what you have learned; Blue can edit these):
${memory}${contextSection}`;
}
