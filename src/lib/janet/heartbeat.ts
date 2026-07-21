// JANET v1 — the heartbeat (spec §8). Once a day she reviews the business and
// composes a calm, short briefing: Needs attention / Suggestions / FYI, each
// item grounded in a real record. Stored in janet_briefings; the panel surfaces
// it via the orb's briefing-waiting state and pins it on the first visit of the
// day. A no-news day says so in two lines.

import { supabaseAdmin } from '../supabase';
import { anthropic, MODEL, BLVSTACK_SYSTEM } from '../anthropic';
import { JANET_MODEL } from './config';
import { evaluateStandard } from './standard';
import { runUrlAudit } from './audit';
import { logJanetAction } from './actions';
import { getLatestDreamJournal, journalHeadline, type DreamJournal } from './dream/brief';

export type BriefingItem = { title: string; evidence: string; action?: string };
export type BriefingContent = {
  summary: string;
  needs_attention: BriefingItem[];
  suggestions: BriefingItem[];
  fyi: BriefingItem[];
  // The dreaming phase's output, folded in deterministically (no model) so the
  // morning brief carries what she reconciled/proposed overnight. Null until the
  // dream has run. The review/accept happens on the dream-journal page.
  dream?: DreamJournal | null;
};

const DAY = 86_400_000;

/** Scan every active connected site against the Build Standard, storing each
 *  result (spec §7.2). Runs before the briefing so regression data is fresh. */
export async function runScheduledScans(): Promise<{ site: string; score?: number; error?: string }[]> {
  const { data: sites } = await supabaseAdmin.from('janet_sites').select('id, name, production_url').eq('status', 'active');
  const results: { site: string; score?: number; error?: string }[] = [];
  for (const s of sites ?? []) {
    if (!s.production_url) continue;
    try {
      const audit = await runUrlAudit(s.production_url);
      const standard = evaluateStandard(audit);
      await supabaseAdmin.from('janet_site_scans').insert({
        site_id: s.id,
        scan_type: 'standard',
        results: { standard, audit },
        passed: standard.passed,
        failed: standard.failed,
        score: standard.score,
      });
      // Provenance: the cron acts as JANET, so this scan appears in her audit
      // trail (get_recent_actions) as her own activity, not a black box.
      await logJanetAction({
        tool_name: 'scheduled_scan',
        ring: 2,
        input: { site_id: s.id, site: s.name },
        status: 'completed',
        output_summary: `Scheduled scan (heartbeat): ${s.name} scored ${standard.score} — ${standard.passed} passed / ${standard.failed} failed`,
      });
      results.push({ site: s.name, score: standard.score });
    } catch (err: any) {
      await logJanetAction({
        tool_name: 'scheduled_scan',
        ring: 2,
        input: { site_id: s.id, site: s.name },
        status: 'failed',
        output_summary: `Scheduled scan of ${s.name} failed: ${err?.message ?? 'scan failed'}`,
      });
      results.push({ site: s.name, error: err?.message ?? 'scan failed' });
    }
  }
  return results;
}

/** Compare a site's two most recent scans; report checks that regressed. */
export async function detectRegressions(): Promise<{ site: string; note: string }[]> {
  const out: { site: string; note: string }[] = [];
  const { data: sites } = await supabaseAdmin.from('janet_sites').select('id, name').eq('status', 'active');
  for (const s of sites ?? []) {
    const { data: scans } = await supabaseAdmin
      .from('janet_site_scans')
      .select('score, results, created_at')
      .eq('site_id', s.id)
      .order('created_at', { ascending: false })
      .limit(2);
    if (!scans || scans.length < 2) continue;
    const [latest, prev] = scans;
    if (typeof latest.score === 'number' && typeof prev.score === 'number' && latest.score < prev.score - 4) {
      out.push({ site: s.name, note: `Build Standard score dropped ${prev.score} → ${latest.score}.` });
    }
    // Check-level pass → fail regressions.
    const lc = (latest.results as any)?.standard?.checks ?? [];
    const pc = (prev.results as any)?.standard?.checks ?? [];
    const pmap = new Map(pc.map((c: any) => [c.id, c.status]));
    for (const c of lc) {
      if (c.status === 'fail' && pmap.get(c.id) === 'pass') out.push({ site: s.name, note: `"${c.label}" now failing (was passing).` });
    }
  }
  return out;
}

/** Triage a lead (fit/tier/scope/questions) — same intelligence as the /admin
 *  lead analyze endpoint, run automatically. Returns the analysis JSON. */
async function assessLead(lead: any) {
  const userPrompt = `Lead to evaluate:\n\nName: ${lead.name ?? '—'}\nBusiness: ${lead.business_name ?? '—'}\nWebsite: ${lead.website_url ?? '—'}\nRevenue range: ${lead.revenue_range ?? '—'}\nTimeline: ${lead.timeline ?? '—'}\nBudget: ${lead.budget_tier ?? '—'}\nSource: ${lead.source ?? '—'}\n\nProblem (in their own words):\n${lead.problem ?? '—'}\n\nEvaluate and respond with JSON only.`;
  const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 1024, system: BLVSTACK_SYSTEM, messages: [{ role: 'user', content: userPrompt }] });
  const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
  return JSON.parse(cleaned);
}

const LEAD_DRAFT_SYSTEM = `You are drafting a first-touch email reply from Blue, founder of BLVSTACK, to an inbound lead. Direct, founder-to-founder, no corporate fluff, no emojis, no "I hope this finds you well". Sign as "Blue".
Goal: acknowledge the inquiry, show you read it (reference a specific detail from their problem), and propose ONE concrete next step (a short discovery call if strong, or one clarifying question if borderline). 80-150 words, plain text. Output ONLY the email body, starting with the greeting — no subject line, no preamble.`;

/** Auto-draft a reply so a draft is waiting the moment a lead lands (spec 1.2). */
async function draftLeadReply(lead: any): Promise<string> {
  const firstName = (lead.name ?? '').split(' ')[0] || 'there';
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: LEAD_DRAFT_SYSTEM,
    messages: [{ role: 'user', content: `Lead: ${lead.name ?? '—'} (first name ${firstName}), business ${lead.business_name ?? '—'}, budget ${lead.budget_tier ?? '—'}, timeline ${lead.timeline ?? '—'}.\nTheir problem: ${lead.problem ?? '—'}\n\nDraft the reply.` }],
  });
  return resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
}

/** Urgency = hot | warm | cold from budget, fit, and timeline signals (spec 1.3).
 *  A $50k ASAP strong-fit lead must not read like a tire-kicker. */
export function computeUrgency(lead: any, analysis: any): 'hot' | 'warm' | 'cold' {
  if (analysis?.fit === 'pass') return 'cold';
  const tier = lead.budget_tier ?? analysis?.tier;
  const tierPts = tier === 'L3' ? 3 : tier === 'L2' ? 2 : tier === 'L1' ? 1 : 0;
  const fitPts = analysis?.fit === 'strong' ? 3 : analysis?.fit === 'borderline' ? 1 : 0;
  const tl = String(lead.timeline ?? '').toLowerCase();
  const timePts = /asap|urgent|immediat|right now|today|this week/.test(tl) ? 2 : /month|weeks|soon|quarter|q[1-4]/.test(tl) ? 1 : 0;
  const score = tierPts + fitPts + timePts;
  return score >= 6 ? 'hot' : score >= 3 ? 'warm' : 'cold';
}

/** Count live leads JANET hasn't assessed yet — the cheap guard the hourly lead
 *  cron uses to avoid spending when there's nothing new. */
export async function countUnassessedLeads(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('status', 'new')
    .is('ai_analysis', null);
  return count ?? 0;
}

/** Detect + auto-triage leads JANET hasn't assessed yet ("new to her"), persisting
 *  ai_analysis + logging to the audit trail. Idempotent — once a lead is assessed
 *  it no longer triggers, so the daily heartbeat and the hourly lead cron share
 *  this without re-briefing the same lead. Returns the freshly-assessed leads for
 *  the briefing to brief on. */
export async function detectAndAssessNewLeads(): Promise<any[]> {
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('*')
    .is('deleted_at', null)
    .eq('status', 'new')
    .is('ai_analysis', null)
    .order('created_at', { ascending: false })
    .limit(15);

  const out: any[] = [];
  for (const lead of leads ?? []) {
    try {
      const analysis = await assessLead(lead);
      const urgency = computeUrgency(lead, analysis);
      let ai_draft_reply: string | null = null;
      try {
        ai_draft_reply = await draftLeadReply(lead);
      } catch (e) {
        console.error('[heartbeat] lead draft failed:', (e as Error).message);
      }
      await supabaseAdmin
        .from('leads')
        .update({ ai_analysis: analysis, ai_analyzed_at: new Date().toISOString(), urgency, ai_draft_reply })
        .eq('id', lead.id);
      await logJanetAction({ tool_name: 'assess_lead', ring: 2, input: { lead_id: lead.id }, status: 'completed', output_summary: `Auto-assessed ${lead.name ?? lead.id}: ${urgency.toUpperCase()} · fit ${analysis?.fit ?? '?'} ${analysis?.tier ?? ''}${ai_draft_reply ? '; reply drafted' : ''}` });
      out.push({ id: lead.id, name: lead.name, business_name: lead.business_name, budget_tier: lead.budget_tier, timeline: lead.timeline, problem: lead.problem, analysis, urgency, draft_ready: !!ai_draft_reply });
    } catch (err: any) {
      await logJanetAction({ tool_name: 'assess_lead', ring: 2, input: { lead_id: lead.id }, status: 'failed', output_summary: `Auto-assess failed for ${lead.name ?? lead.id}: ${err?.message ?? 'error'}` });
    }
  }
  // Hot leads first for the briefing.
  const rank = { hot: 0, warm: 1, cold: 2 } as Record<string, number>;
  out.sort((a, b) => (rank[a.urgency] ?? 3) - (rank[b.urgency] ?? 3));
  return out;
}

/** Ledger digest for the briefing — the open recommendations worth chasing and a
 *  lightweight self-scorecard (spec 2.2/2.3: chase open recs + score periodically). */
async function gatherLedger() {
  const { data } = await supabaseAdmin
    .from('janet_recommendations')
    .select('category, confidence, outcome, blue_verdict, recommendation, subject_label, made_at')
    .order('made_at', { ascending: false })
    .limit(1000);
  const rows = data ?? [];
  const now = Date.now();
  const openToChase = rows
    .filter((r) => !r.outcome && (now - new Date(r.made_at).getTime()) / DAY >= 3)
    .slice(0, 8)
    .map((r) => ({ subject: r.subject_label, category: r.category, recommendation: r.recommendation, days_open: Math.floor((now - new Date(r.made_at).getTime()) / DAY) }));
  const resolved = rows.filter((r) => r.outcome && r.outcome !== 'unknown');
  const worked = resolved.filter((r) => r.outcome === 'worked').length;
  const failed = resolved.filter((r) => r.outcome === 'failed').length;
  const partial = resolved.filter((r) => r.outcome === 'partial').length;
  const denom = worked + failed + partial;
  const scorecard = denom > 0
    ? { resolved: resolved.length, worked, failed, partial, hit_rate_pct: Math.round((100 * (worked + partial * 0.5)) / denom), wrong_count: rows.filter((r) => r.blue_verdict === 'wrong').length }
    : null;

  // Prediction accuracy — how well she models Blue (spec 3.4).
  const { data: preds } = await supabaseAdmin.from('janet_predictions').select('outcome').not('outcome', 'is', null).limit(500);
  const scored = preds ?? [];
  const correct = scored.filter((p) => p.outcome === 'correct').length;
  const partialP = scored.filter((p) => p.outcome === 'partial').length;
  const prediction_accuracy = scored.length
    ? { scored: scored.length, correct, accuracy_pct: Math.round((100 * (correct + partialP * 0.5)) / scored.length) }
    : null;

  return { open_to_chase: openToChase, scorecard, prediction_accuracy };
}

async function gather() {
  const now = Date.now();
  const soon = new Date(now + 3 * DAY).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const staleCut = new Date(now - 5 * DAY).toISOString();
  const thirtyAgo = new Date(now - 30 * DAY).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();

  const [stale, dueSoon, replies, retainers, regressions, newLeads, ledger] = await Promise.all([
    supabaseAdmin
      .from('janet_deals')
      .select('name, stage, next_action, updated_at, value_estimate')
      .not('stage', 'in', '(won,lost,delivered)')
      .lt('updated_at', staleCut)
      .order('updated_at', { ascending: true })
      .limit(15),
    supabaseAdmin
      .from('janet_deals')
      .select('name, stage, next_action, next_action_due')
      .gte('next_action_due', today)
      .lte('next_action_due', soon)
      .order('next_action_due', { ascending: true })
      .limit(15),
    supabaseAdmin
      .from('prospects')
      .select('company_name, contact_email, replied_at')
      .eq('status', 'replied')
      .gte('replied_at', dayAgo)
      .limit(15)
      .then((r) => r, () => ({ data: [] as any[] })),
    supabaseAdmin
      .from('janet_sites')
      .select('name, production_url, created_at')
      .eq('status', 'active')
      .eq('retainer_status', 'none')
      .lt('created_at', thirtyAgo)
      .limit(15),
    detectRegressions(),
    detectAndAssessNewLeads(),
    gatherLedger(),
  ]);

  return {
    new_leads: newLeads,
    stale_deals: stale.data ?? [],
    due_soon: dueSoon.data ?? [],
    overnight_replies: (replies as any).data ?? [],
    retainer_opportunities: retainers.data ?? [],
    scan_regressions: regressions,
    open_recommendations_to_chase: ledger.open_to_chase,
    scorecard: ledger.scorecard,
    prediction_accuracy: ledger.prediction_accuracy,
  };
}

const BRIEFING_SYSTEM = `You are JANET composing Blue's daily briefing for BLVSTACK. From the data provided, write a calm, short briefing. Be concrete and evidence-grounded — every item cites the record it came from. Do not invent anything not in the data. If a section has nothing, leave its array empty. If the whole day is quiet, say so in the summary in one or two lines.

Return ONLY valid JSON, no markdown:
{
  "summary": "one or two sentences — the headline of the day",
  "needs_attention": [{ "title": "...", "evidence": "the specific record/metric", "action": "optional one-line suggested next step" }],
  "suggestions": [{ "title": "...", "evidence": "...", "action": "..." }],
  "fyi": [{ "title": "...", "evidence": "..." }]
}

NEW LEADS (highest priority): every entry in "new_leads" is a brand-new inbound inquiry. Put EACH one in needs_attention as a brief — title = who they are (name / business) with its urgency (prefix HOT leads with "🔥 HOT — "), evidence = what they want in one line PLUS your read from their triage analysis (fit, tier, scope_estimate), action = the concrete next step. Each lead has "urgency" (hot/warm/cold) and "draft_ready": order new leads HOT first, and a hot lead (real budget + strong fit + urgent timeline) must read as urgent, NOT like a tire-kicker. When draft_ready is true, say the reply is "drafted and waiting your approval" (it's saved on the lead; sending stays gated). New leads outrank everything else in needs_attention. Never invent a lead not in the data.

ACCOUNTABILITY (your ledger): "open_recommendations_to_chase" are past recommendations of yours with no outcome recorded — put a single fyi item asking what happened to them ("N recommendations still open — X, Y, Z — what happened?") so the ledger doesn't rot; do not invent outcomes. "scorecard" (when present) is your own track record — periodically include ONE fyi line stating your hit rate honestly, e.g. "Scorecard: of N resolved calls, X worked / Y failed (hit rate Z%)" and name that you were judged wrong on wrong_count if any. Be honest about where you were wrong; that's the point.

JUDGMENT ("prediction_accuracy", when present): this is how well you model Blue. Periodically include ONE fyi line stating it honestly — "Modeling you: correctly predicted your call on X of Y scored decisions (Z%)". If it's low, own it.

Rules: needs_attention = new leads + things that will cost Blue if ignored (stalled deals, regressions, due today). suggestions = opportunities (retainer pitches, referral timing). fyi = context (replies to read, ledger chase, scorecard). Order by impact, new leads first. No emojis, no exclamation points.`;

/** Generate today's briefing and store it (idempotent per date). */
export async function generateBriefing(): Promise<BriefingContent> {
  const data = await gather();

  const resp = await anthropic.messages.create({
    model: JANET_MODEL,
    max_tokens: 1500,
    system: BRIEFING_SYSTEM,
    messages: [{ role: 'user', content: `Today's data:\n${JSON.stringify(data, null, 2)}` }],
  });
  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  let content: BriefingContent;
  try {
    const jsonStr = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    content = JSON.parse(jsonStr);
  } catch {
    content = {
      summary: 'Briefing generation returned an unreadable response — data gathered but not composed.',
      needs_attention: [],
      suggestions: [],
      fyi: [],
    };
  }

  // Fold in the dreaming phase's output — deterministically, never via the model,
  // so the journal facts (and any "didn't finish tonight") can't be reworded or
  // fabricated. Best-effort: a missing/failed journal never blocks the brief.
  try {
    const journal = await getLatestDreamJournal();
    content.dream = journal;
    if (journal && (journal.proposals_pending > 0 || journal.status === 'partial')) {
      content.fyi = [
        { title: 'Dream journal', evidence: journalHeadline(journal), action: 'Review overnight proposals at /admin/janet-dream' },
        ...(content.fyi ?? []),
      ];
    }
  } catch (e) {
    console.error('[heartbeat] dream journal fold-in failed:', (e as Error).message);
  }

  const briefingDate = new Date().toISOString().slice(0, 10);
  await supabaseAdmin
    .from('janet_briefings')
    .upsert({ briefing_date: briefingDate, content, read_at: null }, { onConflict: 'briefing_date' });

  // Provenance: writing the briefing is her activity too.
  await logJanetAction({
    tool_name: 'generate_briefing',
    ring: 2,
    input: { briefing_date: briefingDate },
    status: 'completed',
    output_summary: `Composed daily briefing for ${briefingDate}: ${content.summary}`,
  });

  return content;
}
