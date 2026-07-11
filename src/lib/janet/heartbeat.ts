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

export type BriefingItem = { title: string; evidence: string; action?: string };
export type BriefingContent = {
  summary: string;
  needs_attention: BriefingItem[];
  suggestions: BriefingItem[];
  fyi: BriefingItem[];
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

/** Detect leads that arrived since the last heartbeat run and auto-triage any
 *  not yet assessed (persisting ai_analysis + logging to the audit trail).
 *  Returns compact lead+analysis records for the briefing to brief on. */
export async function detectAndAssessNewLeads(): Promise<any[]> {
  const { data: lastB } = await supabaseAdmin
    .from('janet_briefings')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const cutoff = lastB?.created_at ?? new Date(Date.now() - 2 * DAY).toISOString();
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('*')
    .is('deleted_at', null)
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(15);

  const out: any[] = [];
  for (const lead of leads ?? []) {
    let analysis = lead.ai_analysis;
    if (!analysis) {
      try {
        analysis = await assessLead(lead);
        await supabaseAdmin.from('leads').update({ ai_analysis: analysis, ai_analyzed_at: new Date().toISOString() }).eq('id', lead.id);
        await logJanetAction({ tool_name: 'assess_lead', ring: 2, input: { lead_id: lead.id }, status: 'completed', output_summary: `Auto-assessed new lead ${lead.name ?? lead.id}: fit ${analysis?.fit ?? '?'}, tier ${analysis?.tier ?? '?'}` });
      } catch (err: any) {
        await logJanetAction({ tool_name: 'assess_lead', ring: 2, input: { lead_id: lead.id }, status: 'failed', output_summary: `Auto-assess failed for ${lead.name ?? lead.id}: ${err?.message ?? 'error'}` });
      }
    }
    out.push({ id: lead.id, name: lead.name, business_name: lead.business_name, budget_tier: lead.budget_tier, timeline: lead.timeline, problem: lead.problem, analysis });
  }
  return out;
}

async function gather() {
  const now = Date.now();
  const soon = new Date(now + 3 * DAY).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const staleCut = new Date(now - 5 * DAY).toISOString();
  const thirtyAgo = new Date(now - 30 * DAY).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();

  const [stale, dueSoon, replies, retainers, regressions, newLeads] = await Promise.all([
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
  ]);

  return {
    new_leads: newLeads,
    stale_deals: stale.data ?? [],
    due_soon: dueSoon.data ?? [],
    overnight_replies: (replies as any).data ?? [],
    retainer_opportunities: retainers.data ?? [],
    scan_regressions: regressions,
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

NEW LEADS (highest priority): every entry in "new_leads" is a brand-new inbound inquiry. Put EACH one in needs_attention as a brief — title = who they are (name / business), evidence = what they want in one line PLUS your read from their triage analysis (fit, tier, scope_estimate), action = the concrete suggested next step (e.g. "reply to book a discovery call" or "draft a reply for your approval"). New leads outrank everything else in needs_attention. Never invent a lead not in the data.

Rules: needs_attention = new leads + things that will cost Blue if ignored (stalled deals, regressions, due today). suggestions = opportunities (retainer pitches, referral timing). fyi = context (replies to read). Order by impact, new leads first. No emojis, no exclamation points.`;

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
