// JANET v2 Phase 4D — the weekly PSRx intelligence brief + watchdog + wins.
//
// The recurring retainer deliverable: an INTERNAL brief (Blue sees it, not the
// client) composed on the heavy model (Opus, via JANET_MODEL_HEAVY) from real
// PSRx data + live market research. Every finding cites evidence and respects the
// data_quality caveats; every opportunity ships with a drafted deliverable and is
// logged to the recommendation ledger (the sales asset).

import { anthropic } from '../../anthropic';
import { heavyModel, usdCostOf } from '../config';
import { supabaseAdmin } from '../../supabase';
import { logJanetAction } from '../actions';
import {
  analyzePsrxAnalyzer, analyzePsrxRevenueBySource, analyzePsrxPortalRetention,
  analyzePsrxReputation, getPsrxBookingVisibility,
} from './intelligence';
import { getPsrxSnapshot, getPsrxHealth } from './reads';

async function psrxSiteScans() {
  const { data: site } = await supabaseAdmin
    .from('janet_sites')
    .select('id, name, production_url, repo_url')
    .ilike('name', '%psrx%')
    .limit(1)
    .maybeSingle();
  if (!site) return { site: null, scans: [] as any[], repo_findings: [] as any[] };
  // Scores only — NOT the full results blob (audit findings balloon the prompt).
  const { data: scans } = await supabaseAdmin
    .from('janet_site_scans')
    .select('id, scan_type, score, passed, failed, created_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(8);
  // Compact top findings from the latest repo audit only.
  let repo_findings: any[] = [];
  const latestRepo = (scans ?? []).find((s: any) => s.scan_type === 'repo');
  if (latestRepo) {
    const { data: full } = await supabaseAdmin.from('janet_site_scans').select('results').eq('id', latestRepo.id).single();
    const f = (full?.results as any)?.repo?.findings ?? [];
    repo_findings = f.slice(0, 8).map((x: any) => ({ severity: x.severity, issue: String(x.issue ?? x.title ?? '').slice(0, 140) }));
  }
  return { site: { name: site.name, url: site.production_url, repo: site.repo_url }, scans: (scans ?? []).map(({ id, ...s }) => s), repo_findings };
}

/** Everything the brief reasons over — real data, each piece self-captioned. */
async function gatherPsrxIntel() {
  // Sequential (the transaction pooler deadlocks on pipelined concurrent queries).
  const snapshot = await getPsrxSnapshot();
  const analyzer = await analyzePsrxAnalyzer();
  const revenue = await analyzePsrxRevenueBySource();
  const retention = await analyzePsrxPortalRetention();
  const reputation = await analyzePsrxReputation();
  const health = await getPsrxHealth();
  const booking = getPsrxBookingVisibility();
  const technical = await psrxSiteScans();
  return { snapshot, funnel: snapshot.leads, analyzer, revenue, retention, reputation, health, booking, technical };
}

const BRIEF_SYSTEM = `You are JANET composing the WEEKLY INTELLIGENCE BRIEF for PSRx Body & Skin — a med spa, BLVSTACK's client-one. This is INTERNAL: Blue (BLVSTACK's founder) reads it, the client does not. This brief is the retainer's proof, so it must be genuinely excellent and ruthlessly honest.

You are given real PSRx data. Compose the brief from it. Absolute rules:
- EVERY finding cites its evidence (a number, a record, a source). No vibes.
- RESPECT the data_quality / caveat fields in the data. Where they say the data is insufficient or unreachable (analyzer is mostly test rows; portal has ~0 real members; reviews table absent; AestheticsPro bookings unreachable), SAY SO PLAINLY. Do NOT invent trends, quotes, or revenue you cannot see.
- Use the web_search tool for the market_competitive section: research the current aesthetics / med-spa vertical (tattoo removal, laser for darker skin / Fitzpatrick IV-VI, med-spa membership models, what's converting). Cite what you find.
- Opportunities are ranked by MONEY and each ships with a DRAFTED DELIVERABLE — the actual campaign copy / pricing change / protocol / offer text Blue can execute or approve in one step, not "you should do X".

Return ONLY valid JSON, no markdown fences:
{
  "summary": "2-3 sentences — the headline of the week, honest about data maturity",
  "sections": {
    "funnel": "leads in / qualified / converted / where they stall — with numbers",
    "analyzer": "analyzer patterns OR an honest 'insufficient data' with what's needed",
    "revenue_per_source": "conversion by source; which to scale/kill; cite the no-$ caveat",
    "portal": "retention / the assessment→portal funnel break — the real numbers",
    "reputation": "campaign performance + review availability, honestly",
    "technical_health": "site health/uptime + audit findings (Next.js CVEs etc.), ranked by business impact",
    "market_competitive": "what you found via web_search about the vertical"
  },
  "opportunities": [
    { "title": "...", "evidence": "the data/number behind it", "drafted_deliverable": "the actual copy/pricing/protocol text", "est_impact": "money-tied estimate or 'unquantifiable until X'", "confidence": 0.0 }
  ]
}`;

function extractText(content: any[]): string {
  return (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/** Robustly pull the JSON brief out of a (possibly web-search-augmented,
 *  fence-wrapped) response. Returns null if unparseable. */
function parseBrief(raw: string): PsrxBrief | null {
  let t = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  t = t.slice(start, end + 1);
  try {
    const o = JSON.parse(t);
    if (o && typeof o.summary === 'string') return o as PsrxBrief;
    return null;
  } catch {
    return null;
  }
}

function mondayOf(d: Date): string {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

export type PsrxBrief = {
  summary: string;
  sections: Record<string, string>;
  opportunities: Array<{ title: string; evidence: string; drafted_deliverable: string; est_impact?: string; confidence?: number }>;
  _raw?: string;
  _stop?: string;
};

/** Generate, log opportunities to the ledger, and store the weekly brief. */
export async function generatePsrxBrief(): Promise<{ brief: PsrxBrief; cost_usd: number; opportunities_logged: number; brief_id: string | null }> {
  const intel = await gatherPsrxIntel();
  const heavy = heavyModel(); // resolves + warns if escalation is a no-op
  const resp = await anthropic.messages.create({
    model: heavy,
    max_tokens: 6000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 } as any],
    system: BRIEF_SYSTEM,
    messages: [{ role: 'user', content: `PSRx real data (respect the data_quality/caveat fields):\n\n${JSON.stringify(intel, null, 2)}\n\nCompose this week's intelligence brief. Return ONLY the JSON object, no prose before or after, no markdown fences.` }],
  });
  const cost_usd = usdCostOf(resp.usage as any, heavy);

  const text = extractText(resp.content as any[]);
  const parsed = parseBrief(text);
  // On a parse failure, do NOT persist a junk row or log empty opportunities —
  // return the raw for debugging and let the caller (cron) surface the failure.
  if (!parsed) {
    await logJanetAction({
      tool_name: 'generate_psrx_brief', ring: 2, input: {}, status: 'failed',
      output_summary: `PSRx brief parse failed (stop=${(resp as any).stop_reason}); $${cost_usd.toFixed(3)}. Raw head: ${text.slice(0, 200)}`,
    });
    return {
      brief: { summary: 'Brief generation returned an unreadable response — data gathered but not composed.', sections: {}, opportunities: [], _raw: text.slice(0, 1200), _stop: (resp as any).stop_reason },
      cost_usd, opportunities_logged: 0, brief_id: null,
    };
  }
  const brief = parsed;

  // Log every opportunity to the ledger (4C.8/4D.3 — the retainer's defense).
  let logged = 0;
  for (const opp of brief.opportunities ?? []) {
    if (!opp?.title) continue;
    const conf = typeof opp.confidence === 'number' ? Math.min(Math.max(opp.confidence, 0), 1) : null;
    const { error } = await supabaseAdmin.from('janet_recommendations').insert({
      category: 'revenue_idea',
      subject_type: 'client',
      subject_label: 'PSRx',
      recommendation: opp.title,
      reasoning: `${opp.evidence ?? ''}${opp.est_impact ? ` · impact: ${opp.est_impact}` : ''}`,
      confidence: conf,
      status: 'open',
    });
    if (!error) logged++;
  }

  const week_of = mondayOf(new Date());
  const { data: row } = await supabaseAdmin
    .from('janet_client_briefs')
    .insert({ client_key: 'psrx', week_of, content: brief, cost_usd })
    .select('id')
    .single();

  await logJanetAction({
    tool_name: 'generate_psrx_brief',
    ring: 2,
    input: { week_of },
    status: 'completed',
    output_summary: `PSRx weekly brief: ${brief.summary?.slice(0, 200) ?? ''} (${logged} opportunities logged, $${cost_usd.toFixed(3)})`,
  });

  return { brief, cost_usd, opportunities_logged: logged, brief_id: row?.id ?? null };
}

/** Read the latest stored brief. */
export async function getLatestPsrxBrief() {
  const { data } = await supabaseAdmin
    .from('janet_client_briefs')
    .select('id, week_of, content, cost_usd, created_at')
    .eq('client_key', 'psrx')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { found: true, ...data } : { found: false };
}

/** Watchdog (4D.2) — regressions on the live patient-facing site, flagged before
 *  patients see them: PSRx's own health/uptime + JANET's site/repo scans. */
export async function getPsrxWatchdog() {
  const alerts: string[] = [];
  const health = await getPsrxHealth();
  const redNow = (health.health ?? []).filter((h: any) => h.status === 'red');
  for (const r of redNow) alerts.push(`Health RED: ${r.check_name}${r.error_detail ? ` — ${r.error_detail}` : ''} (${r.severity ?? 'p1'})`);
  if (health.latest_uptime && health.latest_uptime.is_up === false) alerts.push(`Site DOWN: ${health.latest_uptime.url} (${health.latest_uptime.error_detail ?? 'no detail'})`);

  const { scans } = await psrxSiteScans();
  const byType = (t: string) => scans.filter((s: any) => s.scan_type === t);
  for (const t of ['standard', 'repo']) {
    const [latest, prev] = byType(t);
    if (latest && prev && typeof latest.score === 'number' && typeof prev.score === 'number' && latest.score < prev.score - 4) {
      alerts.push(`${t} scan regressed ${prev.score} → ${latest.score} (${latest.created_at?.slice(0, 10)})`);
    }
  }
  return { alerts, health_checks: health.health?.length ?? 0, latest_uptime: health.latest_uptime, scans_reviewed: scans.length };
}

/** Wins (4D.3) — PSRx recommendations → outcomes → dollars, as the sales asset. */
export async function getPsrxWins() {
  const { data } = await supabaseAdmin
    .from('janet_recommendations')
    .select('recommendation, category, confidence, outcome, outcome_value, blue_verdict, made_at')
    .ilike('subject_label', 'PSRx%')
    .order('made_at', { ascending: false })
    .limit(500);
  const rows = data ?? [];
  const resolved = rows.filter((r) => r.outcome && r.outcome !== 'unknown');
  const worked = resolved.filter((r) => r.outcome === 'worked').length;
  const failed = resolved.filter((r) => r.outcome === 'failed').length;
  const partial = resolved.filter((r) => r.outcome === 'partial').length;
  const denom = worked + failed + partial;
  const dollars = resolved.reduce((s, r) => s + (typeof r.outcome_value === 'number' ? r.outcome_value : 0), 0);
  return {
    total_recommendations: rows.length,
    resolved: resolved.length,
    open: rows.length - resolved.length,
    worked, failed, partial,
    hit_rate_pct: denom ? Math.round((100 * (worked + partial * 0.5)) / denom) : null,
    dollars_attributed: dollars,
    recent: rows.slice(0, 15).map((r) => ({ recommendation: r.recommendation, outcome: r.outcome ?? 'open', outcome_value: r.outcome_value, made_at: (r.made_at ?? '').slice(0, 10) })),
    note: 'The retainer defense: recommendations JANET made for PSRx, tracked to outcome. Populate outcomes (via the scorecard) to turn this into the sales asset.',
  };
}
