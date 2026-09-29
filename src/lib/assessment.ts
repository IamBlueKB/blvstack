// BLVSTACK — free project assessment (blvstack.com/assessment).
//
// A six-question form that returns a HIGH-LEVEL brief, on screen and by email:
// goals restated, recommended approach, rough timeline, next step (book a call).
// Deliberately no prices and no specific feature promises — features are scoped
// per build (Blue, 2026-09-29).
//
// Who decides what:
//   - The recommended APPROACH comes from fixed rules (chooseApproach) — the same
//     answers always get the same recommendation.
//   - The TIMELINE and NEXT STEP are fixed text.
//   - Claude writes only the two personal sentences (goals restated, why this
//     approach). Its output is checked against the no-prices / no-feature-promises
//     rule; anything that fails the check, times out, or errors falls back to the
//     template sentences. A visitor always gets a brief.
//
// One lead pipeline: every submission also creates a normal `leads` row (source
// 'assessment'), so JANET triages it, briefs it in the morning, and drafts a
// follow-up that only sends on Blue's approval. The brief email goes out after the
// response via waitUntil; its outcome is recorded on the row — a failed send is
// 'failed' with the error, never swallowed.

import { waitUntil } from '@vercel/functions';
import { anthropic } from './anthropic';
import { supabaseAdmin } from './supabase';
import { resend, FROM_EMAIL, FOUNDER_EMAIL } from './resend';
import { wrapEmail, escapeHtml } from './email-template';
import { NEEDS, GOALS, TIMELINES, MAX_GOALS, type NeedKey, type GoalKey, type TimelineKey, type Approach, type Brief } from './assessment-options';

export const BOOK_CALL_URL = 'https://blvstack.com/call';

export type AssessmentInput = {
  name: string;
  email: string;
  phone: string | null;
  need: NeedKey;
  current_site: string | null;
  goals: GoalKey[];
  about: string;
  timeline: TimelineKey;
};

// ─── Validation ────────────────────────────────────────────────────────────

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Parse + validate a raw request body. Returns the input or a user-facing error. */
export function parseAssessment(body: any): { input: AssessmentInput } | { error: string } {
  const need = body?.need;
  if (!(need in NEEDS)) return { error: 'Pick what you need.' };
  const goals = Array.isArray(body?.goals) ? [...new Set(body.goals as string[])].filter((g) => g in GOALS) : [];
  if (goals.length === 0) return { error: 'Pick at least one thing the site should do.' };
  if (goals.length > MAX_GOALS) return { error: `Pick up to ${MAX_GOALS}.` };
  const timeline = body?.timeline;
  if (!(timeline in TIMELINES)) return { error: 'Pick a timeline.' };
  const about = clip(body?.about, 1200);
  if (about.length < 10) return { error: 'Tell us a little about the business or project.' };
  const name = clip(body?.name, 120);
  if (name.length < 2) return { error: 'Add your name.' };
  const email = clip(body?.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Add a valid email so we can send your brief.' };
  const site = clip(body?.current_site, 300);
  return {
    input: {
      name,
      email,
      phone: clip(body?.phone, 40) || null,
      need,
      current_site: site || null,
      goals: goals as GoalKey[],
      about,
      timeline,
    },
  };
}

// ─── The rules (approved 2026-09-29) ───────────────────────────────────────

/** Fixed routing: the same answers always get the same recommendation. Asking for
 *  AI or automation (as the need or a goal) routes to the AI & Automation service. */
export function chooseApproach(goals: GoalKey[], need: NeedKey): Approach {
  const g = new Set(goals);
  if (need === 'ai' || g.has('automate')) return 'ai_automation';
  if (g.has('retain') || (g.has('leads') && g.has('bookings'))) return 'managed';
  if (g.has('leads') || g.has('bookings') || g.has('sell')) return 'capture_booking';
  return 'focused';
}

const APPROACH_TITLE: Record<Approach, string> = {
  focused: 'A focused build',
  capture_booking: 'A build with lead capture + booking',
  managed: 'A build we run monthly',
  ai_automation: 'A build with AI and automation',
};

const RANGE: Record<Approach, string> = {
  focused: 'about 2–3 weeks from kickoff to launch',
  capture_booking: 'about 3–5 weeks from kickoff to launch',
  managed: 'about 3–5 weeks to launch, then we run it with you month to month',
  ai_automation: 'about 2–4 weeks from kickoff to live',
};

function timelineText(approach: Approach, t: TimelineKey): string {
  const range = RANGE[approach];
  const cap = range.charAt(0).toUpperCase() + range.slice(1);
  switch (t) {
    case 'month':
      return approach === 'focused'
        ? `${cap}, which fits your one-month window.`
        : `${cap}. That's a tight fit for your one-month window, so we'll confirm it on the call.`;
    case 'quarter':
      return `${cap}, which fits your 1–3 month window.`;
    case 'later':
      return `${cap}, well inside your 3+ month window.`;
    case 'exploring':
      return `${cap}, whenever you're ready to start.`;
  }
}

// ─── Template sentences (the fallback — and the floor) ─────────────────────

const NEED_PHRASE: Record<NeedKey, string> = {
  new: 'a new site',
  refresh: 'a refreshed site',
  ai: 'AI and automation',
  unsure: 'a site',
};

const GOAL_PHRASE: Record<GoalKey, string> = {
  credible: 'looks credible and professional',
  leads: 'brings in new leads',
  bookings: 'takes bookings',
  sell: 'sells your products or tickets',
  showcase: 'shows off your work',
  retain: 'keeps clients coming back',
  automate: 'takes repetitive work off your plate',
};

const TEMPLATE_WHY: Record<Approach, string> = {
  focused:
    "Your goals are about how you come across, so the work goes into design, clarity, and speed: a site that makes the right first impression and is easy to keep current.",
  capture_booking:
    'Your goals are about getting inquiries, so the site is built to turn visitors into conversations and make the next step easy.',
  managed:
    "Your goals run past launch day, so we'd build the site and then run it with you month to month, keeping it current and making sure the interest it brings in gets followed up.",
  ai_automation:
    "Your goals are about taking work off your plate, so we'd map where your time goes and build the agents and automations that handle it, shaped around how your business already runs.",
};

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function templateGoals(input: AssessmentInput): string {
  return `You want ${NEED_PHRASE[input.need]} that ${joinList(input.goals.map((g) => GOAL_PHRASE[g]))}.`;
}

// ─── Claude writes the two personal sentences ──────────────────────────────

export const ASSESSMENT_MODEL = import.meta.env.ASSESSMENT_MODEL || 'claude-opus-5-5';
const MODEL_TIMEOUT_MS = 20_000;

/** The AI & Automation approach may name AI and automation in general terms (that's
 *  the approach itself); every approach still names no specific tools or features. */
function systemPrompt(approach: Approach): string {
  const featureRule = approach === 'ai_automation'
    ? '- You may mention AI or automation in general terms, since that is the recommended approach, but name no specific tools, features, or tech: no chatbots, calendars, schedulers, reminders, forms, CRMs, or integrations. Features are scoped later on a call.'
    : '- No specific features, tools, or tech: no calendars, booking systems, schedulers, reminders, forms, CRMs, integrations, chatbots, AI, or automation. Features are scoped later on a call.';
  return `You write two short sentences for a web studio's free project brief. The visitor just answered a questionnaire about the website or the AI and automation they want.

Return ONLY JSON: {"goals": "...", "why": "..."}
- "goals": restate what they're after in one or two sentences, in second person, grounded in their own words. Use their business or project details when given.
- "why": one or two sentences on why the given recommended approach fits their goals.

Hard rules:
- No prices, costs, fees, or budgets.
${featureRule}
- No timelines (they are given separately) and no promises of results.
- Plain, warm, professional. Each field under 45 words.`;
}

/** Anything that reads as a price, a specific feature promise, or an invented
 *  timeline fails the check. Durations are matched only with a number ("3 weeks",
 *  "2–3 months"): "month to month" describes the monthly approach itself and
 *  blocking it threw away good sentences (found in testing, 2026-09-29). */
const FORBIDDEN =
  /\$|\busd\b|\bprice|\bpricing|\bcost|\bfee\b|\bbudget|per month|\/mo\b|\bcalendar|\bremind|\bschedul|\bbooking (system|tool|page|widget|software)|\bonline booking|\bforms?\b|\bcrm\b|\bintegrat|\bchat ?bot|\bguarantee|\b\d+\s*(?:[-–to]+\s*\d+\s*)?(?:days?|weeks?|months?)\b/i;
/** Off-limits for every approach except AI & Automation. */
const AI_WORDS = /\bai\b|\bautomat/i;

function failsCheck(s: string, approach: Approach): boolean {
  return FORBIDDEN.test(s) || (approach !== 'ai_automation' && AI_WORDS.test(s));
}

async function modelSentences(input: AssessmentInput, approach: Approach): Promise<{ goals: string; why: string } | null> {
  const user = [
    `What they need: ${NEEDS[input.need]}`,
    `Current site: ${input.current_site ?? 'none given'}`,
    `What the site should do: ${input.goals.map((g) => GOALS[g]).join('; ')}`,
    `About the business or project, in their words: ${input.about}`,
    `Recommended approach (already decided): ${APPROACH_TITLE[approach]}`,
  ].join('\n');
  try {
    const resp: any = await anthropic.messages.create(
      {
        model: ASSESSMENT_MODEL,
        // Opus 5.5 always thinks, and thinking spends from max_tokens.
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system: systemPrompt(approach),
        messages: [{ role: 'user', content: user }],
      } as any,
      { timeout: MODEL_TIMEOUT_MS }
    );
    if (resp.stop_reason === 'refusal') return null;
    const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const o = JSON.parse(text.slice(start, end + 1));
    const goals = typeof o.goals === 'string' ? o.goals.trim() : '';
    const why = typeof o.why === 'string' ? o.why.trim() : '';
    if (goals.length < 10 || why.length < 10 || goals.length > 400 || why.length > 400) return null;
    if (failsCheck(goals, approach) || failsCheck(why, approach)) return null;
    return { goals, why };
  } catch (e) {
    console.error('[assessment] brief model call failed — using template:', (e as Error).message);
    return null;
  }
}

/** Build the brief. Never throws: a model failure means template sentences. */
export async function buildBrief(input: AssessmentInput): Promise<{ brief: Brief; source: 'model' | 'template'; approach: Approach }> {
  const approach = chooseApproach(input.goals, input.need);
  const written = await modelSentences(input, approach);
  const firstName = input.name.split(/\s+/)[0];
  return {
    approach,
    source: written ? 'model' : 'template',
    brief: {
      name: firstName,
      goals: written?.goals ?? templateGoals(input),
      approach: { key: approach, title: APPROACH_TITLE[approach], why: written?.why ?? TEMPLATE_WHY[approach] },
      timeline: timelineText(approach, input.timeline),
      next_step: { text: "Book a 20-minute call and we'll walk through it together.", url: BOOK_CALL_URL },
    },
  };
}

// ─── Persist: one lead pipeline + the assessment record ────────────────────

/** The need, in third person for JANET and the lead record (the form labels are first person). */
const NEED_FOR_LEAD: Record<NeedKey, string> = {
  new: 'a brand-new site',
  refresh: 'a refresh of their current site',
  ai: 'AI or automation for their business',
  unsure: "a site (not sure yet what kind)",
};

function leadProblem(input: AssessmentInput, brief: Brief): string {
  return [
    `Free project assessment — needs ${NEED_FOR_LEAD[input.need]}${input.current_site ? ` (current site: ${input.current_site})` : ''}.`,
    `Goals: ${input.goals.map((g) => GOALS[g]).join('; ')}.`,
    `In their words: ${input.about}`,
    `Brief they received: ${brief.approach.title} — ${brief.timeline}`,
  ].join('\n');
}

/**
 * Save a submission (lead + assessment), return the brief for the page, and send
 * the brief email after the response. The visitor always gets the brief back; a
 * lead-insert failure is logged loudly but doesn't cost them their brief.
 */
export async function submitAssessment(input: AssessmentInput, ip: string): Promise<{ id: string; brief: Brief }> {
  const { brief, source, approach } = await buildBrief(input);

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads')
    .insert({
      name: input.name,
      email: input.email,
      phone: input.phone,
      website_url: input.current_site,
      problem: leadProblem(input, brief),
      // "ASAP" keeps a one-month timeline reading as urgent in JANET's triage.
      timeline: input.timeline === 'month' ? `ASAP — ${TIMELINES.month.toLowerCase()}` : TIMELINES[input.timeline],
      source: 'assessment',
      status: 'new',
      ip_address: ip,
    })
    .select('id')
    .single();
  if (leadErr) console.error('[assessment] lead insert failed — assessment saved without a lead:', leadErr.message);

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('project_assessments')
    .insert({
      lead_id: lead?.id ?? null,
      name: input.name,
      email: input.email,
      phone: input.phone,
      need: input.need,
      current_site: input.current_site,
      goals: input.goals,
      about: input.about,
      timeline: input.timeline,
      approach,
      brief,
      brief_source: source,
      email_status: 'pending',
      ip_address: ip,
    })
    .select('id')
    .single();
  if (rowErr || !row) throw new Error(`Could not save the assessment: ${rowErr?.message ?? 'no row'}`);

  // After the response: send the brief, record the outcome either way.
  waitUntil(deliverBrief(row.id, input.email, brief));
  return { id: row.id, brief };
}

// ─── The brief email ───────────────────────────────────────────────────────

function briefEmail(b: Brief): { html: string; text: string } {
  const p = (s: string) => `<p style="margin:0 0 18px 0; color:#FAF8F3; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size:15px; line-height:1.65;">${s}</p>`;
  const label = (s: string) => `<p style="margin:0 0 6px 0; color:#94A3B8; font-family:ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size:11px; letter-spacing:0.2em; text-transform:uppercase;">${s}</p>`;
  const body = [
    label('What you&rsquo;re after'), p(escapeHtml(b.goals)),
    label('Recommended approach'), p(`<strong>${escapeHtml(b.approach.title)}.</strong> ${escapeHtml(b.approach.why)}`),
    label('Rough timeline'), p(escapeHtml(b.timeline)),
    label('Next step'), p(escapeHtml(b.next_step.text)),
  ].join('');
  const html = wrapEmail({
    preheader: `${b.approach.title} — your project brief from BLVSTACK.`,
    eyebrow: '// Your project brief',
    title: `${b.name}, here's your brief.`,
    body,
    cta: { label: 'Book a call', href: b.next_step.url },
  });
  const text = [
    `${b.name}, here's your brief.`,
    '',
    `WHAT YOU'RE AFTER\n${b.goals}`,
    '',
    `RECOMMENDED APPROACH\n${b.approach.title}. ${b.approach.why}`,
    '',
    `ROUGH TIMELINE\n${b.timeline}`,
    '',
    `NEXT STEP\n${b.next_step.text}\n${b.next_step.url}`,
    '',
    '— Blue, BLVSTACK',
  ].join('\n');
  return { html, text };
}

/** Send + record. Never rejects: every outcome lands on the row. */
async function deliverBrief(id: string, to: string, brief: Brief): Promise<void> {
  try {
    const { html, text } = briefEmail(brief);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      replyTo: FOUNDER_EMAIL,
      subject: 'Your project brief from BLVSTACK',
      html,
      text,
    });
    if (error) throw new Error(error.message ?? String(error));
    const { error: upErr } = await supabaseAdmin
      .from('project_assessments')
      .update({ email_status: 'sent', email_id: data?.id ?? null, email_sent_at: new Date().toISOString(), email_error: null })
      .eq('id', id);
    if (upErr) console.error('[assessment] email sent but status not recorded:', upErr.message);
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    console.error('[assessment] brief email failed:', message);
    const { error: upErr } = await supabaseAdmin
      .from('project_assessments')
      .update({ email_status: 'failed', email_error: message.slice(0, 500) })
      .eq('id', id);
    if (upErr) console.error('[assessment] email failure not recorded:', upErr.message);
  }
}
