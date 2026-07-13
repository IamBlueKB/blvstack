// JANET Phase 4B — the nurture-lead engine. She qualifies non-converted PSRx leads,
// proposes a per-lead cadence, drafts a personalized follow-up, and QUEUES it for a
// human (the clinic manager) to approve. She NEVER sends.
//
// THE INVARIANT: read every touch signal before drafting; never collide with an
// active send. PSRx's automated drip is dead (verified) and its spec columns
// (nurture_step/converted) don't exist — so `lead_messages` (what was actually sent,
// and when) is the authoritative dedup source, plus status and the do-not-contact list.
//
// Hard guardrails are enforced HERE in code (not just the prompt): never past 3
// JANET follow-ups, never a converted/archived lead, never inside the cooldown,
// never a suppressed lead, never double-queue a lead that already has a pending draft.

import { supabaseAdmin } from '../../supabase';
import { psrxSql, psrxConnected } from './client';

export const NURTURE_COOLDOWN_DAYS = 14; // no JANET draft if any outbound touch is newer than this
export const MAX_JANET_FOLLOWUPS = 3; // hard cap on JANET follow-ups per lead

type Suppression = { emails: Set<string>; leadIds: Set<string> };

/** JANET's do-not-contact / exclusion list (BLVSTACK-side). */
export async function getPsrxSuppression(): Promise<Suppression> {
  const { data } = await supabaseAdmin.from('janet_psrx_suppression').select('lead_id, email');
  const emails = new Set<string>();
  const leadIds = new Set<string>();
  for (const r of data ?? []) {
    if (r.email) emails.add(String(r.email).toLowerCase());
    if (r.lead_id) leadIds.add(String(r.lead_id));
  }
  return { emails, leadIds };
}

const isSuppressed = (s: Suppression, email: string | null, id: string) =>
  s.leadIds.has(id) || (!!email && s.emails.has(email.toLowerCase()));

// Read-side test-record guard (no DB write). The system didn't exist before this,
// so anything backdated earlier is a manual/test entry; plus obvious test patterns.
const LAUNCH_CUTOFF = new Date('2026-05-01');
function isTestLead(l: { email?: string | null; first_name?: string | null; last_name?: string | null; created_at?: string | null }): boolean {
  if (l.created_at && new Date(l.created_at) < LAUNCH_CUTOFF) return true;
  const email = (l.email ?? '').toLowerCase();
  const name = `${l.first_name ?? ''} ${l.last_name ?? ''}`.toLowerCase();
  if (/test|example\.com|demo|fake|asdf|qa@|\+test/.test(email)) return true;
  if (/\btest\b/.test(name)) return true;
  return false;
}

/** Eligible non-converted leads ready for a JANET follow-up — the prioritized queue,
 *  with every hard guardrail already applied. The filtering IS the value. */
export async function getNurtureCandidates(opts: { limit?: number } = {}) {
  const sql = psrxSql();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const suppression = await getPsrxSuppression();

  const rows = await sql`
    select l.id, l.first_name, l.last_name, l.email, l.status, l.primary_concern, l.concerns,
           l.goals, l.timeline, l.referral_source, l.fitzpatrick, l.created_at,
           (select max(m.created_at) from lead_messages m where m.lead_id = l.id and m.direction = 'outbound') as last_outbound_at,
           (select count(*)::int from lead_messages m where m.lead_id = l.id) as total_messages,
           (select count(*)::int from janet_lead_drafts d where d.lead_id = l.id and d.status in ('pending','approved','sent')) as janet_touches,
           (select count(*)::int from janet_lead_drafts d where d.lead_id = l.id and d.status = 'pending') as pending_drafts
    from assessment_leads l
    where l.status not in ('converted','archived')
    order by l.created_at desc`;

  const now = Date.now();
  const cutoffMs = NURTURE_COOLDOWN_DAYS * 86_400_000;
  const excluded: Record<string, number> = { test: 0, suppressed: 0, cooldown: 0, cap_reached: 0, already_queued: 0 };
  const candidates: any[] = [];

  for (const l of rows) {
    if (isTestLead(l)) { excluded.test++; continue; }
    if (isSuppressed(suppression, l.email, l.id)) { excluded.suppressed++; continue; }
    if (l.pending_drafts > 0) { excluded.already_queued++; continue; }
    if (l.janet_touches >= MAX_JANET_FOLLOWUPS) { excluded.cap_reached++; continue; }
    const lastOut = l.last_outbound_at ? new Date(l.last_outbound_at).getTime() : null;
    if (lastOut && now - lastOut < cutoffMs) { excluded.cooldown++; continue; }
    const daysSince = lastOut ? Math.floor((now - lastOut) / 86_400_000) : null;
    candidates.push({
      id: l.id,
      name: `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'unknown',
      email: l.email,
      status: l.status,
      primary_concern: l.primary_concern,
      concerns: l.concerns,
      goals: l.goals,
      timeline: l.timeline,
      referral_source: l.referral_source,
      fitzpatrick: l.fitzpatrick,
      assessed_on: (l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : null),
      days_since_last_touch: daysSince,
      total_prior_messages: l.total_messages,
      janet_follow_ups_so_far: l.janet_touches,
      next_follow_up_number: l.janet_touches + 1,
    });
  }
  return { eligible: candidates.slice(0, limit), eligible_total: candidates.length, excluded };
}

export type QueueDraftInput = {
  lead_id: string;
  qualified: boolean;
  qualification_reasoning: string;
  proposed_cadence?: string;
  cadence_reasoning?: string;
  draft_subject?: string;
  draft_body?: string;
  confidence?: number;
};

/** Queue a drafted follow-up for approval (the ONE write lane) — or record a
 *  "not qualified / don't chase" decision. Re-enforces every hard guardrail in code
 *  and logs the call to the recommendation ledger. NEVER sends. */
export async function queuePsrxLeadDraft(input: QueueDraftInput) {
  const sql = psrxSql();
  const { data: leadRows } = { data: await sql`select id, first_name, last_name, email, status from assessment_leads where id = ${input.lead_id} limit 1` };
  const lead = leadRows[0];
  if (!lead) throw new Error(`PSRx lead ${input.lead_id} not found.`);
  if (lead.status === 'converted' || lead.status === 'archived') {
    throw new Error(`Refused: lead is ${lead.status} — do not nurture.`);
  }

  const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'unknown';
  const confidence = typeof input.confidence === 'number' ? Math.min(Math.max(input.confidence, 0), 1) : null;

  // Log the qualification call to the ledger regardless of qualified/not (4B.5).
  const logRecommendation = async (recommendation: string) => {
    const { data } = await supabaseAdmin.from('janet_recommendations').insert({
      category: 'lead_triage',
      subject_type: 'lead',
      subject_id: input.lead_id,
      subject_label: `PSRx: ${name}`,
      recommendation,
      reasoning: input.qualification_reasoning,
      confidence,
      status: 'open',
    }).select('id').single();
    return data?.id ?? null;
  };

  // Not qualified → record the "don't chase" decision, no queue entry.
  if (input.qualified === false) {
    const recId = await logRecommendation(`Do not follow up${input.proposed_cadence ? ` (${input.proposed_cadence})` : ''}`);
    return { queued: false, qualified: false, recommendation_id: recId, note: 'Recorded as not-qualified; no draft queued.' };
  }

  if (!input.draft_subject || !input.draft_body) {
    throw new Error('A qualified lead needs draft_subject and draft_body to queue.');
  }

  // Re-check the hard guardrails against live data (never trust the caller).
  const suppression = await getPsrxSuppression();
  if (isSuppressed(suppression, lead.email, lead.id)) throw new Error('Refused: lead is on the do-not-contact list.');

  const [g] = await sql`
    select
      (select count(*)::int from janet_lead_drafts d where d.lead_id = ${input.lead_id} and d.status in ('pending','approved','sent')) as janet_touches,
      (select count(*)::int from janet_lead_drafts d where d.lead_id = ${input.lead_id} and d.status = 'pending') as pending,
      (select max(m.created_at) from lead_messages m where m.lead_id = ${input.lead_id} and m.direction = 'outbound') as last_outbound_at`;
  if (g.pending > 0) throw new Error('Refused: this lead already has a draft pending approval.');
  if (g.janet_touches >= MAX_JANET_FOLLOWUPS) throw new Error(`Refused: 3-follow-up cap reached for this lead.`);
  if (g.last_outbound_at && Date.now() - new Date(g.last_outbound_at).getTime() < NURTURE_COOLDOWN_DAYS * 86_400_000) {
    const d = Math.floor((Date.now() - new Date(g.last_outbound_at).getTime()) / 86_400_000);
    throw new Error(`Refused: inside the ${NURTURE_COOLDOWN_DAYS}-day cooldown (last outbound ${d}d ago).`);
  }

  const followUpNumber = g.janet_touches + 1;
  const [draft] = await sql`
    insert into janet_lead_drafts
      (lead_id, qualified, qualification_reasoning, proposed_cadence, cadence_reasoning,
       draft_subject, draft_body, janet_confidence, follow_up_number, status)
    values
      (${input.lead_id}, true, ${input.qualification_reasoning}, ${input.proposed_cadence ?? null},
       ${input.cadence_reasoning ?? null}, ${input.draft_subject}, ${input.draft_body},
       ${confidence}, ${followUpNumber}, 'pending')
    returning id`;

  const recId = await logRecommendation(
    `Follow-up #${followUpNumber} queued${input.proposed_cadence ? `: ${input.proposed_cadence}` : ''} — "${String(input.draft_subject).slice(0, 60)}"`
  );

  return { queued: true, qualified: true, draft_id: draft.id, follow_up_number: followUpNumber, recommendation_id: recId };
}

/** The approval queue state — pending + recently-decided drafts, with the lead. */
export async function getPsrxQueue(opts: { status?: string; limit?: number } = {}) {
  const sql = psrxSql();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.status
    ? await sql`
        select d.id, d.lead_id, l.first_name, l.last_name, l.email, d.qualified, d.qualification_reasoning,
               d.proposed_cadence, d.draft_subject, d.janet_confidence, d.follow_up_number, d.status,
               d.created_at, d.decided_at, d.sent_at
        from janet_lead_drafts d join assessment_leads l on l.id = d.lead_id
        where d.status = ${opts.status} order by d.created_at desc limit ${limit}`
    : await sql`
        select d.id, d.lead_id, l.first_name, l.last_name, l.email, d.qualified, d.qualification_reasoning,
               d.proposed_cadence, d.draft_subject, d.janet_confidence, d.follow_up_number, d.status,
               d.created_at, d.decided_at, d.sent_at
        from janet_lead_drafts d join assessment_leads l on l.id = d.lead_id
        order by d.created_at desc limit ${limit}`;
  const pending = rows.filter((r: any) => r.status === 'pending').length;
  return { count: rows.length, pending, drafts: rows };
}

/** Add a lead/email to the do-not-contact list (opt-out or manager "do not contact"). */
export async function addPsrxSuppression(input: { email?: string; lead_id?: string; reason: string }) {
  if (!input.email && !input.lead_id) throw new Error('Provide an email or lead_id to suppress.');
  const { data, error } = await supabaseAdmin.from('janet_psrx_suppression').insert({
    email: input.email ?? null,
    lead_id: input.lead_id ?? null,
    reason: input.reason,
    created_by: 'janet',
  }).select().single();
  if (error) throw new Error(error.message);
  return { suppressed: true, entry: data };
}
