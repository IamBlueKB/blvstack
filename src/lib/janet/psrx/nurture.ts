// JANET Phase 4B — the PSRx RE-ENGAGEMENT engine. She is the re-engagement layer
// ONLY: leads that were already contacted once (manual first-touch + the AI drafter)
// and went quiet. Never-contacted leads belong to manual first contact.
//
// The cadence comes from the LEAD, not a guessed table. Each assessment carries a
// `timeline` (their stated intent: asap / 1mo / 3mo / researching). JANET honors it,
// counting from LAST CONTACT and adjusting for urgency — she decides the follow-up
// DATE, she doesn't invent intervals. She also decides whether a lead is worth
// re-engaging at all.
//
// RESURFACE, never auto-send: a future-dated follow-up is a SCHEDULE (in her own
// BLVSTACK table). On its date a cron re-checks the guardrails, drafts FRESH with
// current context, and drops a pending row into PSRx's janet_lead_drafts (the
// INSERT-only approval lane) for the clinic manager to approve THAT day. No
// pre-written email is ever fired months later. The human gate holds at send time.
//
// Every cadence decision + its eventual outcome is logged (janet_psrx_followups +
// the ledger) from day one — the hook that lets cadence become empirical later.

import { createHash } from 'node:crypto';
import { anthropic, MODEL } from '../../anthropic';
import { supabaseAdmin } from '../../supabase';
import { psrxSql, psrxConnected } from './client';
import { withLocalTimes, JANET_TZ } from '../time';

export const NURTURE_COOLDOWN_DAYS = 14;
export const MAX_JANET_FOLLOWUPS = 3;
const DAY = 86_400_000;
const clampConf = (n: any) => (typeof n === 'number' && isFinite(n) ? Math.min(Math.max(n, 0), 1) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ─── ATT-8 holdout: a randomized control arm withheld from nurture ────────────
// Why: recovered-revenue is only defensible as LIFT vs a control, not precedence. So a
// share of qualifying leads is deliberately withheld and tracked for organic conversion.
// Assignment is at the LEAD level, deterministic (a salted SHA-256 bucket — the same
// unbiased method feature-flag platforms use internally), and PERSISTED on
// janet_psrx_followups.arm so it is STABLE across runs even if the % later changes.
// Rolled rather than run through PostHog experiments because blvstack has no PostHog
// server client — the release decision runs here, in JANET's engine, not in the psrx app.
const HOLDOUT_PCT = Math.max(0, Math.min(100, Number(import.meta.env.PSRX_HOLDOUT_PCT ?? 25)));
const HOLDOUT_SALT = 'psrx_nurture_holdout_v1';
export function nurtureArm(leadId: string): 'control' | 'treatment' {
  const bucket = createHash('sha256').update(`${HOLDOUT_SALT}:${leadId}`).digest().readUInt32BE(0) % 100;
  return bucket < HOLDOUT_PCT ? 'control' : 'treatment';
}
/** A lead's arm: the PERSISTED value if any of its followup rows already carries one
 *  (locked at first assignment — immune to a later % change), else a fresh deterministic
 *  assignment. Persisting the first assignment is what keeps the split stable across runs. */
async function armForLead(leadId: string): Promise<'control' | 'treatment'> {
  const { data } = await supabaseAdmin.from('janet_psrx_followups').select('arm').eq('lead_id', leadId).not('arm', 'is', null).limit(1);
  const persisted = (data?.[0] as any)?.arm;
  return persisted === 'control' || persisted === 'treatment' ? persisted : nurtureArm(leadId);
}

// ─── do-not-contact + test guards ─────────────────────────────────────
type Suppression = { emails: Set<string>; leadIds: Set<string> };
export async function getPsrxSuppression(): Promise<Suppression> {
  const { data } = await supabaseAdmin.from('janet_psrx_suppression').select('lead_id, email');
  const emails = new Set<string>(), leadIds = new Set<string>();
  for (const r of data ?? []) { if (r.email) emails.add(String(r.email).toLowerCase()); if (r.lead_id) leadIds.add(String(r.lead_id)); }
  return { emails, leadIds };
}
const isSuppressed = (s: Suppression, email: string | null, id: string) =>
  s.leadIds.has(id) || (!!email && s.emails.has(email.toLowerCase()));

const LAUNCH_CUTOFF = new Date('2026-05-01');
function isTestLead(l: { email?: string | null; first_name?: string | null; last_name?: string | null; created_at?: string | null }): boolean {
  if (l.created_at && new Date(l.created_at) < LAUNCH_CUTOFF) return true;
  const email = (l.email ?? '').toLowerCase();
  const name = `${l.first_name ?? ''} ${l.last_name ?? ''}`.toLowerCase();
  if (/test|example\.com|demo|fake|asdf|qa@|\+test/.test(email)) return true;
  if (/\btest\b/.test(name)) return true;
  return false;
}

/** Leads that already have an active plan (scheduled or released) — don't re-plan. */
async function getPlannedLeadIds(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from('janet_psrx_followups').select('lead_id').in('status', ['scheduled', 'released']);
  return new Set((data ?? []).map((r) => String(r.lead_id)));
}

// ─── candidates: already-emailed, non-converted, gone quiet — enriched ─
// Cold clock = last ACTUAL contact of ANY channel (email OR call/text via
// contacted_at). Deliverability + engagement (bounce/unsub/opens/clicks) and
// intent signals (tattoo analysis, portal signup) come along for the ride.
const lastActualContact = (l: any): number => {
  const em = l.last_outbound_at ? new Date(l.last_outbound_at).getTime() : 0;
  const any = l.contacted_at ? new Date(l.contacted_at).getTime() : 0;
  return Math.max(em, any);
};

export async function getNurtureCandidates(opts: { limit?: number } = {}) {
  const sql = psrxSql();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 300);
  const suppression = await getPsrxSuppression();
  const planned = await getPlannedLeadIds();

  const rows = await sql`
    select l.id, l.first_name, l.last_name, l.email, l.status, l.primary_concern, l.concerns,
           l.goals, l.timeline, l.referral_source, l.fitzpatrick, l.created_at,
           l.contacted_at, l.last_contact_method, l.contacted_via_call, l.contacted_via_text,
           (select max(m.created_at) from lead_messages m where m.lead_id = l.id and m.direction = 'outbound') as last_outbound_at,
           (select count(*)::int from lead_messages m where m.lead_id = l.id and m.direction = 'outbound') as outbound_count,
           (select count(*)::int from lead_messages m where m.lead_id = l.id and m.opened_at is not null) as opens,
           (select count(*)::int from lead_messages m where m.lead_id = l.id and m.clicked_at is not null) as clicks,
           (select count(*)::int from lead_messages m where m.lead_id = l.id and m.unsubscribed_at is not null) as unsubs,
           (select bounced_at from lead_messages m where m.lead_id = l.id and m.direction = 'outbound' order by m.created_at desc limit 1) as latest_bounced,
           exists(select 1 from tattoo_analyses ta where ta.assessment_lead_id = l.id) as has_analysis,
           exists(select 1 from portal_members pm where lower(pm.email) = lower(l.email)) as portal_member,
           (select count(*)::int from janet_lead_drafts d where d.lead_id = l.id and d.status in ('pending','approved','sent')) as janet_touches,
           (select count(*)::int from janet_lead_drafts d where d.lead_id = l.id and d.status = 'pending') as pending_drafts
    from assessment_leads l
    where l.status not in ('converted','archived')
    order by l.created_at desc`;

  const now = Date.now();
  const excluded: Record<string, number> = { test: 0, never_emailed: 0, suppressed: 0, bounced_or_unsub: 0, portal_member: 0, already_planned: 0, cooldown: 0, cap_reached: 0, already_queued: 0 };
  const candidates: any[] = [];
  for (const l of rows) {
    if (isTestLead(l)) { excluded.test++; continue; }
    if (!l.last_outbound_at || l.outbound_count < 1) { excluded.never_emailed++; continue; }  // re-engagement needs a prior email
    if (isSuppressed(suppression, l.email, l.id)) { excluded.suppressed++; continue; }
    if (l.latest_bounced || l.unsubs > 0) { excluded.bounced_or_unsub++; continue; }           // deliverability / opted out
    if (l.portal_member) { excluded.portal_member++; continue; }                                 // already engaged (joined portal)
    if (planned.has(String(l.id))) { excluded.already_planned++; continue; }
    if (l.pending_drafts > 0) { excluded.already_queued++; continue; }
    if (l.janet_touches >= MAX_JANET_FOLLOWUPS) { excluded.cap_reached++; continue; }
    const cold = lastActualContact(l);
    if (now - cold < NURTURE_COOLDOWN_DAYS * DAY) { excluded.cooldown++; continue; }             // too recently contacted, any channel
    candidates.push({
      id: l.id,
      name: `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'unknown',
      email: l.email,
      primary_concern: l.primary_concern,
      concerns: l.concerns,
      goals: l.goals,
      timeline: l.timeline,
      fitzpatrick: l.fitzpatrick,
      referral_source: l.referral_source,
      assessed_on: l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : null,
      last_contacted_on: new Date(cold).toISOString().slice(0, 10),
      last_contact_method: l.last_contact_method ?? (l.last_outbound_at ? 'email' : null),
      days_since_last_touch: Math.floor((now - cold) / DAY),
      prior_outbound: l.outbound_count,
      // engagement + intent signals for triage
      email_opens: l.opens, email_clicks: l.clicks,
      ran_tattoo_analysis: l.has_analysis === true,
      janet_follow_ups_so_far: l.janet_touches,
      next_follow_up_number: l.janet_touches + 1,
    });
  }
  return { eligible: candidates.slice(0, limit), eligible_total: candidates.length, excluded };
}

// ─── guardrails, re-checked at plan time AND surface time ─────────────
async function checkGuardrails(sql: ReturnType<typeof psrxSql>, lead: any): Promise<{ ok: boolean; reason?: string; janet_touches: number }> {
  if (lead.status === 'converted' || lead.status === 'archived') return { ok: false, reason: `lead is ${lead.status}`, janet_touches: 0 };
  const supp = await getPsrxSuppression();
  if (isSuppressed(supp, lead.email, lead.id)) return { ok: false, reason: 'on the do-not-contact list', janet_touches: 0 };
  const [g] = await sql`
    select
      (select count(*)::int from lead_messages m where m.lead_id = ${lead.id} and m.direction = 'outbound') as outbound_count,
      (select max(m.created_at) from lead_messages m where m.lead_id = ${lead.id} and m.direction = 'outbound') as last_outbound_at,
      (select bounced_at from lead_messages m where m.lead_id = ${lead.id} and m.direction = 'outbound' order by m.created_at desc limit 1) as latest_bounced,
      (select count(*)::int from lead_messages m where m.lead_id = ${lead.id} and m.unsubscribed_at is not null) as unsubs,
      (select contacted_at from assessment_leads where id = ${lead.id}) as contacted_at,
      exists(select 1 from portal_members pm where lower(pm.email) = lower(${lead.email ?? ''})) as portal_member,
      (select count(*)::int from janet_lead_drafts d where d.lead_id = ${lead.id} and d.status in ('pending','approved','sent')) as janet_touches,
      (select count(*)::int from janet_lead_drafts d where d.lead_id = ${lead.id} and d.status = 'pending') as pending`;
  if (g.outbound_count < 1) return { ok: false, reason: 'never emailed (belongs to manual first-contact)', janet_touches: 0 };
  if (g.latest_bounced || g.unsubs > 0) return { ok: false, reason: 'bounced or unsubscribed', janet_touches: g.janet_touches };
  if (g.portal_member) return { ok: false, reason: 'already a portal member (engaged)', janet_touches: g.janet_touches };
  if (g.pending > 0) return { ok: false, reason: 'already has a pending draft', janet_touches: g.janet_touches };
  if (g.janet_touches >= MAX_JANET_FOLLOWUPS) return { ok: false, reason: '3-follow-up cap reached', janet_touches: g.janet_touches };
  const cold = Math.max(g.last_outbound_at ? new Date(g.last_outbound_at).getTime() : 0, g.contacted_at ? new Date(g.contacted_at).getTime() : 0);
  if (Date.now() - cold < NURTURE_COOLDOWN_DAYS * DAY) return { ok: false, reason: `inside the ${NURTURE_COOLDOWN_DAYS}-day cooldown (any channel)`, janet_touches: g.janet_touches };
  return { ok: true, janet_touches: g.janet_touches };
}

// ─── fresh drafting (at surface time — never pre-written months ahead) ─
// Real PSRx CTAs (from the live site nav/float buttons — do not change without
// checking psrxbodyandskin.com). Consult is the primary ask; the $29/mo skin
// portal is the softer secondary option for a lead not ready to book.
// These must match what PSRx's own email linkifier (bodyToHtml in psrx-nextjs
// lib/brevo.ts) recognizes, so each renders as a branded CTA button in the sent
// email: /booknow → "Book Consultation", /join → "Start Your Portal — $29/mo".
// Using /portal instead of /join would fall through to a plain underlined link.
export const PSRX_BOOKING_URL = 'https://web2.myaestheticspro.com/booknow/index.cfm?1077761A4DA57E0B9DE46679DC541702';
export const PSRX_PORTAL_URL = 'https://psrxbodyandskin.com/join';

/** The greeting name — the lead's real first name, or "there" if it's missing or
 *  clearly not a personal name (e.g. "Popup Lead"). The model is told to use this
 *  EXACTLY and never invent a name (it was writing "Hi Janet" to a "Popup Lead"). */
function greetingName(lead: any): string {
  const first = String(lead.first_name ?? lead.name ?? '').trim().split(/\s+/)[0] ?? '';
  const junk = /^(popup|lead|unknown|test|guest|customer|there|none|na|n\/a|null)$/i;
  if (!first || first.length < 2 || junk.test(first)) return 'there';
  return first;
}

const DRAFT_SYSTEM = `You are drafting a RE-ENGAGEMENT follow-up email from PSRx Body & Skin (a Chicago med spa) to a lead who did the skin assessment, already received one reply from the clinic, and then went quiet. This is a FOLLOW-UP, not a first contact — acknowledge you reached out before, don't reintroduce the clinic from scratch.

Rules:
- Open the body with EXACTLY "Hi {FIRST_NAME}," using the FIRST_NAME given below. NEVER invent, guess, or substitute a different name. If FIRST_NAME is "there", write "Hi there,". Do NOT put a personal name in the subject line unless it is the real FIRST_NAME (never "there").
- Reference their SPECIFIC concern and goal from the assessment (shows it's personal, not a blast).
- Give a genuine reason to reconnect now; honor their stated timeline. No fake urgency, no "just checking in."
- TWO next steps, woven in naturally:
  PRIMARY — book a free consultation. Include this exact link: ${PSRX_BOOKING_URL}
  SECONDARY (softer, for someone not ready to book) — point them to the PSRx skin portal, our AI-powered skincare membership from $29/mo. Include this exact link: ${PSRX_PORTAL_URL}
  The consult is the main ask; the portal is a low-commitment alternative. Use the two URLs verbatim — do not alter, shorten, or invent a different link. Put EACH link on its OWN LINE (nothing else on that line) — the send system turns a URL on its own line into a branded button.
- No emojis, no corporate fluff. 100-160 words, plain text. Sign "PSRx Body & Skin, Chicago".

Output ONLY JSON: {"subject": "...", "body": "..."} — no markdown, no preamble.`;

export async function draftPsrxFollowup(lead: any, priorMessages: any[], followUpNumber: number): Promise<{ subject: string; body: string }> {
  const firstName = greetingName(lead);
  // NB: the postgres driver returns timestamptz as a Date, not a string — coerce
  // before slicing (a bare .slice on a Date throws and broke every draft that had
  // prior messages, i.e. every real re-engagement lead).
  const fmtDate = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const prior = (priorMessages ?? []).map((m) => `- ${m.subject ?? '(no subject)'} (${fmtDate(m.created_at)})`).join('\n') || 'none on record';
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content:
      `FIRST_NAME: ${firstName}\nPrimary concern: ${lead.primary_concern ?? '—'}\nConcerns: ${JSON.stringify(lead.concerns ?? [])}\nGoals: ${JSON.stringify(lead.goals ?? [])}\nStated timeline: ${lead.timeline ?? '—'}\nFitzpatrick: ${lead.fitzpatrick ?? '—'}\nThis is follow-up #${followUpNumber}. Prior emails they received:\n${prior}\n\nDraft the re-engagement email. Open with "Hi ${firstName},". Return ONLY the JSON.` }],
  });
  const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  const obj = JSON.parse(s >= 0 ? text.slice(s, e + 1) : text);
  return { subject: String(obj.subject ?? '').trim(), body: String(obj.body ?? '').trim() };
}

// ─── the plan: decline / schedule / draft-now (the ONE write lane) ────
export type PlanInput = {
  lead_id: string;
  worth_engaging: boolean;
  qualification_reasoning: string;
  timeline_bucket?: string;
  review_on?: string; // ISO date JANET decided (from the lead's timeline + last contact)
  cadence_reasoning?: string;
  tone?: string;
  confidence?: number;
};

async function logCadenceRecommendation(
  lead: any,
  name: string,
  text: string,
  reasoning: string,
  confidence: number | null,
  resolved?: { detail: string }
): Promise<string | null> {
  // A "do not re-engage" decision has no future outcome to record — the decision IS
  // the resolution. Born resolved (outcome='unknown', status='accepted') so it never
  // enters the open-rec chase and never nags. Everything else stays open as before.
  const base: Record<string, unknown> = {
    category: 'lead_triage', subject_type: 'lead', subject_id: lead.id, subject_label: `PSRx: ${name}`,
    recommendation: text, reasoning, confidence, status: 'open',
  };
  if (resolved) {
    base.status = 'accepted';
    base.outcome = 'unknown';
    base.outcome_recorded_at = new Date().toISOString();
    base.outcome_detail = resolved.detail;
  }
  const { data } = await supabaseAdmin.from('janet_recommendations').insert(base).select('id').single();
  return data?.id ?? null;
}

export async function planPsrxFollowup(input: PlanInput) {
  const sql = psrxSql();
  const [lead] = await sql`select id, first_name, last_name, email, status, primary_concern, concerns, goals, timeline, fitzpatrick from assessment_leads where id = ${input.lead_id} limit 1`;
  if (!lead) throw new Error(`PSRx lead ${input.lead_id} not found.`);
  const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'unknown';
  const confidence = clampConf(input.confidence);
  const bucket = input.timeline_bucket ?? 'none';
  const reviewOn = input.review_on ?? today();

  // Not worth re-engaging → record the decision, no schedule/draft.
  if (input.worth_engaging === false) {
    const recId = await logCadenceRecommendation(lead, name, `Do not re-engage (timeline: ${bucket})`, input.qualification_reasoning, confidence, { detail: 'Self-resolving: chose not to re-engage; the decision is the resolution.' });
    await supabaseAdmin.from('janet_psrx_followups').insert({ lead_id: lead.id, lead_email: lead.email, lead_name: name, timeline_bucket: bucket, review_on: reviewOn, qualification_reasoning: input.qualification_reasoning, cadence_reasoning: input.cadence_reasoning ?? null, confidence, status: 'declined', recommendation_id: recId });
    return { planned: false, declined: true, recommendation_id: recId };
  }

  const g = await checkGuardrails(sql, lead);
  if (!g.ok) throw new Error(`Refused: ${g.reason}.`);
  const followUpNumber = g.janet_touches + 1;

  // ATT-8: control arm — record the plan but WITHHOLD it (never drafted, scheduled, or
  // released). A 'held_out' row is DELIBERATELY withheld — distinct from declined/cancelled/
  // failed — and is still reconciled for outcomes so we learn whether the control converts
  // on its own. This is what makes any recovered-revenue number LIFT, not precedence.
  const arm = await armForLead(lead.id);
  if (arm === 'control') {
    const recId = await logCadenceRecommendation(lead, name, `Held out (control arm) · follow-up #${followUpNumber} · timeline ${bucket}`, input.qualification_reasoning, confidence, { detail: 'ATT-8 holdout: control arm — deliberately withheld from nurture; tracked for organic conversion.' });
    await supabaseAdmin.from('janet_psrx_followups').insert({ lead_id: lead.id, lead_email: lead.email, lead_name: name, timeline_bucket: bucket, review_on: reviewOn, follow_up_number: followUpNumber, qualification_reasoning: input.qualification_reasoning, cadence_reasoning: input.cadence_reasoning ?? null, confidence, status: 'held_out', arm: 'control', recommendation_id: recId });
    return { planned: true, held_out: true, arm: 'control', follow_up_number: followUpNumber, recommendation_id: recId };
  }

  const due = reviewOn <= today();
  const recId = await logCadenceRecommendation(
    lead, name,
    `Re-engage · follow-up #${followUpNumber} · timeline ${bucket} · review ${reviewOn}${due ? ' (due now)' : ''}`,
    `${input.qualification_reasoning}${input.cadence_reasoning ? ` · cadence: ${input.cadence_reasoning}` : ''}`,
    confidence
  );

  if (due) {
    const prior = await sql`select subject, body, created_at from lead_messages where lead_id = ${lead.id} and direction = 'outbound' order by created_at desc limit 3`;
    const draft = await draftPsrxFollowup(lead, prior, followUpNumber);
    const [d] = await sql`
      insert into janet_lead_drafts (lead_id, qualified, qualification_reasoning, proposed_cadence, cadence_reasoning, draft_subject, draft_body, janet_confidence, follow_up_number, status)
      values (${lead.id}, true, ${input.qualification_reasoning}, ${bucket}, ${input.cadence_reasoning ?? null}, ${draft.subject}, ${draft.body}, ${confidence}, ${followUpNumber}, 'pending')
      returning id`;
    await supabaseAdmin.from('janet_psrx_followups').insert({ lead_id: lead.id, lead_email: lead.email, lead_name: name, timeline_bucket: bucket, review_on: reviewOn, follow_up_number: followUpNumber, qualification_reasoning: input.qualification_reasoning, cadence_reasoning: input.cadence_reasoning ?? null, confidence, status: 'released', arm: 'treatment', recommendation_id: recId, draft_id: d.id, released_at: new Date().toISOString() });
    return { planned: true, due: true, arm: 'treatment', draft_id: d.id, follow_up_number: followUpNumber, recommendation_id: recId };
  }

  await supabaseAdmin.from('janet_psrx_followups').insert({ lead_id: lead.id, lead_email: lead.email, lead_name: name, timeline_bucket: bucket, review_on: reviewOn, follow_up_number: followUpNumber, qualification_reasoning: input.qualification_reasoning, cadence_reasoning: input.cadence_reasoning ?? null, confidence, status: 'scheduled', arm: 'treatment', recommendation_id: recId });
  return { planned: true, scheduled: true, review_on: reviewOn, follow_up_number: followUpNumber, recommendation_id: recId };
}

// ─── on-demand queue: draft NOW, bypass the SCHEDULE only (Blue names a lead) ─
// The sweep handles automatic cadence; this handles exceptions ("queue Brianna").
// Every SAFETY guardrail still applies and is NOT bypassable — only the review
// date is overridden. Refusals return a plain reason she reports (never flails).
export async function queuePsrxLeadNow(leadId: string) {
  const sql = psrxSql();
  const [lead] = await sql`select id, first_name, last_name, email, status, primary_concern, concerns, goals, timeline, fitzpatrick from assessment_leads where id = ${leadId} limit 1`;
  if (!lead) throw new Error(`PSRx lead ${leadId} not found.`);
  const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'unknown';

  // Safety guardrails — converted / do-not-contact / never-emailed / bounced /
  // portal member / pending draft / 3-cap / cooldown. NONE are bypassable here.
  const g = await checkGuardrails(sql, lead);
  if (!g.ok) throw new Error(`Refused: ${g.reason}. Only the schedule is bypassable on-demand — never a safety rule.`);

  const followUpNumber = g.janet_touches + 1;
  const prior = await sql`select subject, body, created_at from lead_messages where lead_id = ${lead.id} and direction = 'outbound' order by created_at desc limit 3`;
  const draft = await draftPsrxFollowup(lead, prior, followUpNumber);

  const recId = await logCadenceRecommendation(
    lead, name,
    `Re-engage NOW (on-demand) · follow-up #${followUpNumber}`,
    'Queued on demand by Blue — schedule bypassed, safety guardrails applied',
    0.6
  );
  const [d] = await sql`
    insert into janet_lead_drafts (lead_id, qualified, qualification_reasoning, proposed_cadence, cadence_reasoning, draft_subject, draft_body, janet_confidence, follow_up_number, status)
    values (${lead.id}, true, ${'Queued on demand by Blue (schedule bypassed; safety guardrails applied)'}, ${lead.timeline ?? 'on_demand'}, ${'on-demand queue'}, ${draft.subject}, ${draft.body}, ${0.6}, ${followUpNumber}, 'pending')
    returning id`;
  await supabaseAdmin.from('janet_psrx_followups').insert({
    lead_id: lead.id, lead_email: lead.email, lead_name: name, timeline_bucket: lead.timeline ?? 'on_demand',
    review_on: today(), follow_up_number: followUpNumber,
    qualification_reasoning: 'on-demand queue by Blue', cadence_reasoning: 'schedule bypassed', confidence: 0.6,
    status: 'released', recommendation_id: recId, draft_id: d.id, released_at: new Date().toISOString(),
  });
  return { queued: true, lead_id: lead.id, lead_name: name, draft_id: d.id, follow_up_number: followUpNumber, subject: draft.subject, recommendation_id: recId };
}

// ─── the release cron: draft fresh on the review date, queue for approval ─
export async function releaseDuePsrxFollowups() {
  if (!psrxConnected()) return { released: 0, skipped: 0, note: 'PSRx not connected' };
  const sql = psrxSql();
  const { data: due } = await supabaseAdmin.from('janet_psrx_followups').select('*').eq('status', 'scheduled').lte('review_on', today()).order('review_on').limit(50);
  const released: any[] = [], skipped: any[] = [];
  for (const f of due ?? []) {
    const [lead] = await sql`select id, first_name, last_name, email, status, primary_concern, concerns, goals, timeline, fitzpatrick from assessment_leads where id = ${f.lead_id} limit 1`;
    if (!lead) { await supabaseAdmin.from('janet_psrx_followups').update({ status: 'cancelled' }).eq('id', f.id); skipped.push({ lead: f.lead_name, reason: 'lead gone' }); continue; }
    // ATT-8 safety net: never release a control-arm lead. New control rows are born
    // 'held_out', but this catches any 'scheduled' row that predates assignment.
    const arm = f.arm ?? await armForLead(f.lead_id);
    if (arm === 'control') {
      await supabaseAdmin.from('janet_psrx_followups').update({ status: 'held_out', arm: 'control' }).eq('id', f.id);
      skipped.push({ lead: f.lead_name, reason: 'held out (control arm)' });
      continue;
    }
    const g = await checkGuardrails(sql, lead);
    if (!g.ok) {
      const converted = lead.status === 'converted';
      await supabaseAdmin.from('janet_psrx_followups').update({ status: converted ? 'converted' : 'cancelled', outcome: converted ? 'converted' : null, outcome_recorded_at: new Date().toISOString() }).eq('id', f.id);
      skipped.push({ lead: f.lead_name, reason: g.reason }); continue;
    }
    try {
      const prior = await sql`select subject, body, created_at from lead_messages where lead_id = ${f.lead_id} and direction = 'outbound' order by created_at desc limit 3`;
      const draft = await draftPsrxFollowup(lead, prior, g.janet_touches + 1);
      const [d] = await sql`
        insert into janet_lead_drafts (lead_id, qualified, qualification_reasoning, proposed_cadence, cadence_reasoning, draft_subject, draft_body, janet_confidence, follow_up_number, status)
        values (${f.lead_id}, true, ${f.qualification_reasoning}, ${f.timeline_bucket}, ${f.cadence_reasoning}, ${draft.subject}, ${draft.body}, ${f.confidence}, ${g.janet_touches + 1}, 'pending')
        returning id`;
      await supabaseAdmin.from('janet_psrx_followups').update({ status: 'released', draft_id: d.id, released_at: new Date().toISOString() }).eq('id', f.id);
      released.push({ lead: f.lead_name, draft_id: d.id });
    } catch (e: any) {
      skipped.push({ lead: f.lead_name, reason: 'draft failed: ' + e.message });
    }
  }
  return { released: released.length, skipped: skipped.length, detail: { released, skipped } };
}

// ─── reconcile outcomes — the learning-loop data accrues here ─────────
// Attribute what happened after each follow-up: converted (from status), engaged
// (joined the portal, or opened/clicked the email), the manager's action on the
// draft (approved/edited/rejected), or no response after a window. This is the
// signal that lets cadence + segment judgment become empirical over time.
export async function reconcilePsrxFollowups() {
  if (!psrxConnected()) return { reconciled: 0 };
  const sql = psrxSql();
  const now = new Date().toISOString();
  // 'held_out' included: the control arm MUST be reconciled for organic conversion —
  // a control that we never track is worthless. It converts/engages/ages-out like a
  // released row, just without an email (its arm='control' marks it as deliberate).
  const { data: fups } = await supabaseAdmin.from('janet_psrx_followups').select('*').in('status', ['released', 'scheduled', 'held_out']).is('outcome', null).limit(400);
  let reconciled = 0;
  for (const f of fups ?? []) {
    const [lead] = await sql`select id, status, email from assessment_leads where id = ${f.lead_id} limit 1`;
    if (!lead) continue;
    const patch: Record<string, any> = {};

    if (lead.status === 'converted') {
      patch.outcome = 'converted'; patch.outcome_recorded_at = now;
      if (f.status === 'scheduled') patch.status = 'converted';
    } else {
      const [pm] = await sql`select 1 as x from portal_members where lower(email) = lower(${lead.email ?? ''}) limit 1`;
      if (pm) { patch.outcome = 'engaged_portal'; patch.outcome_recorded_at = now; }
    }

    if (f.draft_id) {
      const [d] = await sql`select status, sent_message_id, edited_subject, edited_body from janet_lead_drafts where id = ${f.draft_id} limit 1`;
      if (d) {
        if (d.status === 'rejected') patch.manager_action = 'rejected';
        else if (d.status === 'sent') {
          patch.manager_action = d.edited_subject || d.edited_body ? 'edited' : 'approved';
          if (d.sent_message_id) {
            const [eng] = await sql`select (opened_at is not null) as opened, (clicked_at is not null) as clicked from lead_messages where brevo_message_id = ${d.sent_message_id} limit 1`;
            if (eng?.opened) patch.opened = true;
            if (eng?.clicked) patch.clicked = true;
          }
        }
      }
    }

    // Terminal "no response" once a touch (released) or a control withholding (held_out)
    // has aged out with no conversion. Held-out rows have no released_at, so age from
    // created_at; they can never be opened/clicked (no email) → they resolve 'no_response'.
    const ageBasis = f.released_at ?? f.created_at;
    if (!patch.outcome && (f.status === 'released' || f.status === 'held_out') && ageBasis && Date.now() - new Date(ageBasis).getTime() > 45 * DAY) {
      patch.outcome = patch.clicked || patch.opened ? 'engaged_no_book' : 'no_response';
      patch.outcome_recorded_at = now;
    }

    if (Object.keys(patch).length) { await supabaseAdmin.from('janet_psrx_followups').update(patch).eq('id', f.id); reconciled++; }
  }
  return { reconciled };
}

// ─── ATT-8 holdout split — the control-vs-treatment ledger for the report/dashboard ──
/** Distinct-lead split by arm. `leaked_released` on control MUST be 0 (a control lead that
 *  ever got released is a contaminated control). Held-out leads are excluded from release
 *  (status 'held_out') but still carry outcomes, so `converted` is measurable per arm. */
export async function getHoldoutSplit() {
  const { data } = await supabaseAdmin.from('janet_psrx_followups').select('lead_id, arm, status, outcome');
  const byLead = new Map<string, { arm: string | null; heldOut: boolean; released: boolean; converted: boolean; outcomeSet: boolean }>();
  for (const r of (data ?? []) as any[]) {
    const e = byLead.get(r.lead_id) ?? { arm: null, heldOut: false, released: false, converted: false, outcomeSet: false };
    if (r.arm) e.arm = r.arm;
    if (r.status === 'held_out') e.heldOut = true;
    if (r.status === 'released' || r.status === 'converted') e.released = e.released || r.status === 'released';
    if (r.outcome === 'converted') e.converted = true;
    if (r.outcome) e.outcomeSet = true;
    byLead.set(r.lead_id, e);
  }
  const leads = [...byLead.values()];
  const control = leads.filter((l) => l.arm === 'control');
  const treatment = leads.filter((l) => l.arm === 'treatment');
  const unassigned = leads.filter((l) => !l.arm).length;
  const control_n = control.length;
  const treatment_n = treatment.length;
  // Power caveat — same discipline as the pending/recovered split: never let a surface
  // render a lift number that looks more solid than it is. Below this floor the arm is
  // directional only; any consumer MUST show `caveat` next to any lift figure.
  const MIN_POWER_N = 30;
  const underpowered = control_n < MIN_POWER_N;
  return {
    holdout_pct_target: HOLDOUT_PCT,
    leads_assigned: control_n + treatment_n,
    unassigned,
    // Report SIZE next to conversions so lift is never shown without its n. `underpowered`
    // and `caveat` must be surfaced wherever a lift/conversion-rate comparison is rendered.
    power: {
      control_n,
      treatment_n,
      min_for_power: MIN_POWER_N,
      underpowered,
      caveat: underpowered
        ? `Control arm n=${control_n} (< ${MIN_POWER_N}) — DIRECTIONAL ONLY, not statistically powered. Any lift/conversion-rate figure derived from this must be labeled directional; do not present it as a solid number.`
        : null,
    },
    control: {
      leads: control_n,
      held_out: control.filter((l) => l.heldOut).length,
      leaked_released: control.filter((l) => l.released).length, // MUST be 0
      converted_organic: control.filter((l) => l.converted).length,
      reconciled: control.filter((l) => l.outcomeSet).length,
    },
    treatment: {
      leads: treatment_n,
      released: treatment.filter((l) => l.released).length,
      converted: treatment.filter((l) => l.converted).length,
      reconciled: treatment.filter((l) => l.outcomeSet).length,
    },
  };
}

// ─── the sweep: triage all eligible leads, cadence from THEIR timeline ─
/** The empirical yardstick — what actually converts. JANET bounces cold leads
 *  against this: resemblance to real converters = worth chasing. */
export async function getConverterProfile() {
  const sql = psrxSql();
  const [row] = await sql`
    select
      (select count(*)::int from assessment_leads where status = 'converted') as converted_total,
      (select json_agg(t) from (
        select coalesce(timeline,'(null)') as timeline, count(*)::int as n
        from assessment_leads where status = 'converted' group by 1 order by n desc) t) as by_timeline,
      (select json_agg(t) from (
        select coalesce(primary_concern,'(null)') as concern, count(*)::int as n
        from assessment_leads where status = 'converted' group by 1 order by n desc) t) as by_concern`;
  return row ?? { converted_total: 0, by_timeline: [], by_concern: [] };
}

const SWEEP_SYSTEM = `You are JANET triaging PSRx cold leads for RE-ENGAGEMENT. Every lead was already contacted once and then went quiet.

CONVERTER_PROFILE IS A PRIOR, NOT A FILTER. You are given the profile of leads who have booked so far. It is a TINY sample from the OLD manual process, before your re-engagement existed — so "asap has converted, researching hasn't" is a starting hint, NOT a verdict. Your outreach is a NEW intervention that may convert segments which never converted before, and you only learn that by reaching out and watching outcomes accumulate over time. So: proven segments (asap + a real concern) get priority and higher confidence; unproven segments (1mo / 3mo / researching WITH a real concern) still get a fair, calibrated shot — lower priority, gentler, lower confidence — because reaching out to them is HOW YOU LEARN what you can convert. Do NOT write a lead off just because it doesn't match past converters. Only skip (worth_engaging=false) leads with genuinely NO signal — no real concern or goal.

TWO SIGNALS, KEPT SEPARATE:
1. The COLD CLOCK = \`days_since_last_touch\` — time since their LAST ACTUAL CONTACT. This is your primary timing input.
2. The customer's stated \`timeline\` (asap / 1mo / 3mo / researching) is their TREATMENT GOAL — their buying window, NOT a follow-up schedule. Do NOT map it to an interval. Instead READ IT AGAINST THE ELAPSED TIME to infer WHERE THIS PERSON IS NOW, then decide the follow-up from that.

Reading timeline against elapsed time (examples, not rules):
- "asap" but weeks cold → they were in-market and stalled; re-engage soon, low-friction — "are you still looking?"
- "1mo" and the ~month has PASSED with no booking → window came and went; "still thinking about X?"
- "3mo" and only a few weeks elapsed → EARLY in their window; stay present with a light, value-first touch, and time a stronger nudge as their ~3-month mark nears. Do NOT go silent for the whole window — that's how you lose them.
- "researching" → not ready yet; gentle, useful, low-pressure — still worth a light touch to learn whether you can move them.

CADENCE: start from sensible re-engagement intervals (first nudge roughly 2-3 weeks after going cold, spaced touches after, within the 3-follow-up cap) but ADAPT — more or less frequent — by your read of readiness-vs-elapsed and concern strength. The adaptivity is the point; you refine it as you see what gets responses.

ENGAGEMENT + INTENT SIGNALS (weight these):
- email_opens / email_clicks on prior touches = they ARE still paying attention even if they didn't book → stronger candidate, chase with more confidence. Many sends with zero opens = they're not seeing/ignoring it → lower priority (and note the possible deliverability issue).
- ran_tattoo_analysis = they went further than the assessment → higher intent, prioritize.
- last_contact_method tells you the channel of their last touch (email/call/text).

DELIBERATE SPREAD — you get the whole eligible pool in batches. Keep a spread across timeline buckets (asap/1mo/3mo/researching) AND concerns in your worth_engaging=true set. Do NOT pursue only the proven "asap" segment — if you never try the others you never learn whether you can convert them. Exploration is required, not optional.

For EACH lead decide:
- worth_engaging (bool): false ONLY for genuinely no-signal leads (no real concern/goal). Anyone with a real concern gets a calibrated shot, even unproven segments.
- current_read: ONE line — where they are now, from timeline read against elapsed time (this is the insight).
- review_on (YYYY-MM-DD): the next-contact date, from your RE-ENGAGEMENT judgment (cold-duration + lead quality + concern urgency), informed by the read. The stated timeline does NOT mechanically set this date.
- timeline_bucket: their stated bucket ('asap'|'1mo'|'3mo'|'researching'|'other'|'none') — stored as context only.
- tone: 'direct' | 'value-first' | 'gentle'.
- confidence: 0-1.

Return ONLY a JSON array: [{"lead_id":"...","worth_engaging":true,"current_read":"...","review_on":"YYYY-MM-DD","timeline_bucket":"...","tone":"...","confidence":0.0}]. No prose, no fences.`;

async function decideCadenceBatch(chunk: any[], todayStr: string, converterProfile: any): Promise<any[]> {
  const leads = chunk.map((c) => ({ lead_id: c.id, name: c.name, primary_concern: c.primary_concern, concerns: c.concerns, goals: c.goals, timeline: c.timeline, days_since_last_touch: c.days_since_last_touch, last_contacted_on: c.last_contacted_on, last_contact_method: c.last_contact_method, prior_touches: c.prior_outbound, email_opens: c.email_opens, email_clicks: c.email_clicks, ran_tattoo_analysis: c.ran_tattoo_analysis }));
  const resp = await anthropic.messages.create({
    model: MODEL, max_tokens: 2200, system: SWEEP_SYSTEM,
    messages: [{ role: 'user', content: `Today: ${todayStr}\n\nCONVERTER_PROFILE (who actually booked — your yardstick):\n${JSON.stringify(converterProfile, null, 2)}\n\nCold, already-contacted leads to triage:\n${JSON.stringify(leads, null, 2)}\n\nReturn ONLY the JSON array.` }],
  });
  const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  try { return JSON.parse(s >= 0 ? text.slice(s, e + 1) : text); } catch { return []; }
}

/** Run all eligible cold leads through triage → plan (schedule or draft-now). */
export async function runPsrxNurtureSweep(opts: { limit?: number; dryRun?: boolean } = {}) {
  const { eligible } = await getNurtureCandidates({ limit: opts.limit ?? 80 });
  const converterProfile = await getConverterProfile();
  const results = { candidates: eligible.length, converter_profile: converterProfile, dry_run: !!opts.dryRun, scheduled: 0, due_queued: 0, declined: 0, errors: 0, decisions: [] as any[] };
  const t = today();
  for (let i = 0; i < eligible.length; i += 12) {
    const chunk = eligible.slice(i, i + 12);
    const decisions = await decideCadenceBatch(chunk, t, converterProfile);
    for (const dec of decisions) {
      const cand = chunk.find((c) => c.id === dec.lead_id);
      if (!cand) continue;
      if (opts.dryRun) {
        results.decisions.push({ name: cand.name, timeline: cand.timeline, days_cold: cand.days_since_last_touch, worth: dec.worth_engaging !== false, read: dec.current_read, review_on: dec.review_on, tone: dec.tone, confidence: dec.confidence });
        if (dec.worth_engaging === false) results.declined++;
        else if ((dec.review_on ?? t) <= t) results.due_queued++;
        else results.scheduled++;
        continue;
      }
      try {
        const r = await planPsrxFollowup({ lead_id: dec.lead_id, worth_engaging: dec.worth_engaging !== false, qualification_reasoning: dec.current_read ?? 'triaged for re-engagement', timeline_bucket: dec.timeline_bucket, review_on: dec.review_on, cadence_reasoning: dec.current_read, tone: dec.tone, confidence: dec.confidence });
        if ((r as any).declined) results.declined++;
        else if ((r as any).due) results.due_queued++;
        else results.scheduled++;
        results.decisions.push({ name: cand.name, timeline: cand.timeline, days_cold: cand.days_since_last_touch, worth: dec.worth_engaging !== false, read: dec.current_read, review_on: dec.review_on, tone: dec.tone });
      } catch (e: any) {
        results.errors++;
        results.decisions.push({ name: cand.name, error: e.message });
      }
    }
  }
  return results;
}

/** The weekly job: reconcile outcomes, release due-dated follow-ups into the
 *  approval queue (drafting fresh), then sweep newly-eligible cold leads. */
export async function runPsrxNurtureCycle() {
  const reconciled = await reconcilePsrxFollowups();
  const released = await releaseDuePsrxFollowups();
  const swept = await runPsrxNurtureSweep({});
  return {
    reconciled: reconciled.reconciled,
    released: released.released,
    swept: { candidates: swept.candidates, scheduled: swept.scheduled, due_queued: swept.due_queued, declined: swept.declined, errors: swept.errors },
  };
}

// ─── split cadence ────────────────────────────────────────────────────
// A re-engagement system's edge is speed: a lead who comes due today must draft
// today, not on the next weekly run. So RELEASE + RECONCILE run DAILY (draft due
// follow-ups the day they come due; accrue outcomes), while the cold-lead SWEEP
// stays WEEKLY (no need to re-scan the whole pool every day).

/** DAILY: score outcomes, then draft every due-dated follow-up into the approval
 *  queue. No sweep. She never sends — the clinic manager approves. */
export async function runPsrxDailyCycle() {
  const reconciled = await reconcilePsrxFollowups();
  const released = await releaseDuePsrxFollowups();
  return { reconciled: reconciled.reconciled, released: released.released, detail: released.detail };
}

/** WEEKLY: sweep newly-cold leads into the re-engagement schedule. */
export async function runPsrxWeeklySweep() {
  const swept = await runPsrxNurtureSweep({});
  return { swept: { candidates: swept.candidates, scheduled: swept.scheduled, due_queued: swept.due_queued, declined: swept.declined, errors: swept.errors } };
}

// ─── reads ────────────────────────────────────────────────────────────
export async function getPsrxFollowups(opts: { status?: string; limit?: number } = {}) {
  // lead_id (full UUID) is included so a follow-up is ACTIONABLE — she looks the
  // lead up or queues it verbatim; she never reconstructs an id from name/email.
  let q = supabaseAdmin.from('janet_psrx_followups')
    .select('id, lead_id, lead_name, lead_email, timeline_bucket, review_on, follow_up_number, cadence_reasoning, status, released_at, outcome, created_at')
    .order('review_on', { ascending: true }).limit(Math.min(Math.max(opts.limit ?? 100, 1), 300));
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const scheduled = (data ?? []).filter((r) => r.status === 'scheduled').length;
  const followups = (data ?? []).map((r: any) => withLocalTimes(r, ['released_at', 'created_at']));
  return { count: (data ?? []).length, scheduled, timezone: JANET_TZ, followups };
}

export async function getPsrxQueue(opts: { status?: string; limit?: number } = {}) {
  const sql = psrxSql();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.status
    ? await sql`select d.id, d.lead_id, l.first_name, l.last_name, l.email, d.qualification_reasoning, d.proposed_cadence, d.draft_subject, d.janet_confidence, d.follow_up_number, d.status, d.created_at, d.decided_at, d.sent_at from janet_lead_drafts d join assessment_leads l on l.id = d.lead_id where d.status = ${opts.status} order by d.created_at desc limit ${limit}`
    : await sql`select d.id, d.lead_id, l.first_name, l.last_name, l.email, d.qualification_reasoning, d.proposed_cadence, d.draft_subject, d.janet_confidence, d.follow_up_number, d.status, d.created_at, d.decided_at, d.sent_at from janet_lead_drafts d join assessment_leads l on l.id = d.lead_id order by d.created_at desc limit ${limit}`;
  // Timestamps are stored UTC; attach Blue-local siblings so she reports his clock
  // without doing timezone math (see time.ts — converted at the boundary).
  const drafts = rows.map((r: any) => withLocalTimes(r, ['created_at', 'decided_at', 'sent_at']));
  return { count: rows.length, pending: rows.filter((r: any) => r.status === 'pending').length, timezone: JANET_TZ, drafts };
}

export async function addPsrxSuppression(input: { email?: string; lead_id?: string; reason: string }) {
  if (!input.email && !input.lead_id) throw new Error('Provide an email or lead_id to suppress.');
  const { data, error } = await supabaseAdmin.from('janet_psrx_suppression').insert({ email: input.email ?? null, lead_id: input.lead_id ?? null, reason: input.reason, created_by: 'janet' }).select().single();
  if (error) throw new Error(error.message);
  return { suppressed: true, entry: data };
}
