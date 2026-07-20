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
import { anthropic } from '../anthropic';
import { JANET_MODEL } from './config';
import { logJanetAction } from './actions';
import { composeReply } from '../reply-composer';

const DAY = 86_400_000;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

/** Draft an email body in Blue's voice for a prepared decision (Sonnet). */
async function draftEmailBody(system: string, context: string): Promise<string> {
  const resp = await anthropic.messages.create({ model: JANET_MODEL, max_tokens: 500, system, messages: [{ role: 'user', content: context }] });
  return resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
}

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

/** Unanswered contact-form messages → a prepared send-decision each (drafting the
 *  reply if one isn't saved yet, in Blue's voice, via the shared composer). */
async function messageDecisions(): Promise<PreparedDecision[]> {
  const { data: msgs } = await supabaseAdmin
    .from('contact_messages')
    .select('id, name, email, message, draft_subject, draft_body')
    .is('replied_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(10);
  const out: PreparedDecision[] = [];
  for (const m of msgs ?? []) {
    if (!m.email) continue;
    let subject = m.draft_subject as string | null;
    let body = m.draft_body as string | null;
    if (!subject || !body) {
      try {
        const r = await composeReply({ name: m.name, email: m.email, message: m.message });
        subject = r.subject; body = r.body;
        await supabaseAdmin.from('contact_messages').update({ draft_subject: subject, draft_body: body }).eq('id', m.id);
      } catch { continue; }
    }
    const who = m.name ?? m.email;
    out.push({
      kind: 'initiative', priority: 45, value_estimate: null,
      evidence: `Unanswered contact message — ${who} <${m.email}>: "${String(m.message ?? '').slice(0, 90)}"`,
      summary: `Reply to ${who}`,
      proposals: [{ tool: 'send_message_reply', input: { message_id: m.id, subject, body }, summary: `Send drafted reply to ${who}` }],
      dedup_key: `send_message_reply:${m.id}`,
    });
  }
  return out;
}

const RETAINER_SYSTEM = `You are Blue, founder of BLVSTACK, emailing a client whose site you delivered, to propose an ongoing maintenance + monitoring retainer. Direct, founder-to-founder, no fluff, no emojis, no "hope this finds you well". Reference the site by name, note you keep it monitored/updated/fast and fix small things before they break, propose the monthly figure plainly, and offer to start. 80-130 words, plain text, sign as "Blue". Output ONLY the email body.`;

/** Delivered sites with no retainer (30+ days) whose client has an email → a prepared
 *  retainer-pitch send-decision (drafted). Converting delivered builds into MRR. */
async function retainerDecisions(): Promise<PreparedDecision[]> {
  const cut = new Date(Date.now() - 30 * DAY).toISOString();
  const { data: sites } = await supabaseAdmin
    .from('janet_sites')
    .select('id, name, production_url, retainer_status, retainer_monthly, client_id, client_name, created_at')
    .in('status', ['active', 'delivered'])
    .eq('retainer_status', 'none')
    .lt('created_at', cut)
    .limit(8);
  const out: PreparedDecision[] = [];
  for (const s of sites ?? []) {
    let email: string | null = null;
    let contact = s.client_name as string | null;
    if (s.client_id) {
      const { data: c } = await supabaseAdmin.from('janet_clients').select('contact_email, contact_name').eq('id', s.client_id).maybeSingle();
      email = c?.contact_email ?? null;
      contact = c?.contact_name ?? contact;
    }
    if (!email) continue; // no recipient → can't prepare a send
    const mrr = Number(s.retainer_monthly ?? 0) || 500;
    let body: string;
    try {
      body = await draftEmailBody(RETAINER_SYSTEM, `Site: ${s.name} (${s.production_url}). Client contact: ${contact ?? 'there'}. Delivered ~${daysSince(s.created_at)} days ago, no retainer yet. Proposed monitoring/maintenance: $${mrr}/mo. Draft the pitch.`);
    } catch { continue; }
    out.push({
      kind: 'initiative', priority: 50, value_estimate: mrr * 12,
      evidence: `Delivered site, no retainer — ${s.name} (${s.production_url}), ${daysSince(s.created_at)}d since build. Client ${contact ?? '?'}.`,
      summary: `Pitch retainer to ${contact ?? s.client_name ?? s.name} (~$${mrr}/mo)`,
      proposals: [{ tool: 'send_email', input: { to: email, subject: `Keeping ${s.name} sharp`, body }, summary: `Send retainer pitch to ${contact ?? email}` }],
      dedup_key: `send_email:${email.toLowerCase()}`,
    });
  }
  return out;
}

const DEAL_NUDGE_SYSTEM = `You are Blue, founder of BLVSTACK, writing a brief follow-up to move a stalled deal forward. Direct, warm, no fluff, no emojis. Acknowledge where things stand without being needy, and propose ONE concrete next step (a short call, a decision, a scope confirmation). 60-110 words, plain text, sign as "Blue". Output ONLY the email body.`;

/** Deals that stalled (open, untouched 7+ days) with a contact email → a prepared
 *  follow-up send-decision (drafted). Keeps the pipeline from silently dying. */
async function dealNudgeDecisions(): Promise<PreparedDecision[]> {
  const cut = new Date(Date.now() - 7 * DAY).toISOString();
  const { data: deals } = await supabaseAdmin
    .from('janet_deals')
    .select('id, name, contact_name, contact_email, stage, value_estimate, next_action, updated_at')
    .not('stage', 'in', '(won,lost,delivered)')
    .not('contact_email', 'is', null)
    .lt('updated_at', cut)
    .order('updated_at', { ascending: true })
    .limit(6);
  const out: PreparedDecision[] = [];
  for (const d of deals ?? []) {
    let body: string;
    try {
      body = await draftEmailBody(DEAL_NUDGE_SYSTEM, `Deal: ${d.name} (stage ${d.stage}). Contact: ${d.contact_name ?? 'there'}. Last touched ${daysSince(d.updated_at)} days ago. Current next action: ${d.next_action ?? 'none set'}. Draft the follow-up.`);
    } catch { continue; }
    out.push({
      kind: 'initiative', priority: 35, value_estimate: d.value_estimate != null ? Number(d.value_estimate) : null,
      evidence: `Stale deal — ${d.name} [${d.stage}]${d.value_estimate ? ` ~$${Number(d.value_estimate).toLocaleString()}` : ''}, ${daysSince(d.updated_at)}d untouched. Contact ${d.contact_name ?? d.contact_email}.`,
      summary: `Follow up ${d.name} (${d.stage}, ${daysSince(d.updated_at)}d stale)`,
      proposals: [{ tool: 'send_email', input: { to: d.contact_email, subject: `Following up — ${d.name}`, body, deal_id: d.id }, summary: `Send follow-up to ${d.contact_name ?? d.contact_email}` }],
      dedup_key: `send_email:${String(d.contact_email).toLowerCase()}`,
    });
  }
  return out;
}

const GENERATORS: (() => Promise<PreparedDecision[]>)[] = [leadDecisions, messageDecisions, retainerDecisions, dealNudgeDecisions];

/** The dedup key a stored proposal maps to (must match the generators' keys). */
function proposalDedupKey(p: { tool: string; input: any }): string | null {
  if (p?.tool === 'send_lead_reply' && p.input?.lead_id) return `send_lead_reply:${p.input.lead_id}`;
  if (p?.tool === 'send_message_reply' && p.input?.message_id) return `send_message_reply:${p.input.message_id}`;
  if (p?.tool === 'send_email' && p.input?.to) return `send_email:${String(p.input.to).toLowerCase()}`;
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
