/**
 * Researcher agent — reads a prospect's company website and identifies
 * specific pain points that BLVSTACK can solve.
 *
 * Niche-aware: when a prospect has `niche` set (and the niche is live),
 * the researcher prompt is extended with that niche's pain-point focus,
 * qualifying signals, and disqualifying signals.
 *
 * Also exports `detectNiche()` — scans website text + URL to auto-classify
 * a prospect into one of the niches in `src/lib/niches/`.
 */

import { anthropic, MODEL } from '../anthropic';
import { getNiche, listNiches } from '../niches';

const RESEARCHER_SYSTEM = `You are a prospect research agent for BLVSTACK, an AI systems studio.

BLVSTACK builds AI systems for businesses ready to operate at a higher standard:
- L1 Agents: Single-purpose AI agents (lead routing, support triage, content workflows). $5K-$15K.
- L2 Systems: Multi-step automations (CRM workflows, intake pipelines, agent orchestration). $15K-$35K.
- L3 Interfaces: Custom internal tools, dashboards, admin systems. $25K-$50K+.

You will be given a prospect's company website content. Your job is to identify specific, concrete pain points or opportunities where BLVSTACK could help.

Output ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "company_summary": "1-2 sentences about what this company does",
  "employee_range": "estimated company size if inferable, otherwise 'unknown'",
  "pain_points": [
    {
      "problem": "specific problem they likely have",
      "blvstack_solution": "what BLVSTACK would build to solve it",
      "tier": "L1" | "L2" | "L3",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "outreach_angle": "the single strongest reason to reach out — one sentence",
  "contact_hints": {
    "emails_found": ["any emails found on the site"],
    "team_members": ["names of founders/leaders found"],
    "contact_page_url": "URL of their contact page if found"
  }
}

Rules:
- Be SPECIFIC to this company. "They probably need better workflows" is too vague.
- Reference actual things you see on their site (services, products, team, tools).
- If the site is too thin to analyze, say so in company_summary and return empty pain_points.
- Only report emails/names actually found on the page, never fabricate.`;

export interface ResearchResult {
  company_summary: string;
  employee_range: string;
  pain_points: {
    problem: string;
    blvstack_solution: string;
    tier: string;
    confidence: string;
  }[];
  outreach_angle: string;
  contact_hints: {
    emails_found: string[];
    team_members: string[];
    contact_page_url: string | null;
  };
}

export async function researchProspect(
  companyName: string,
  companyUrl: string,
  pageContent: string,
  options?: { niche?: string | null }
): Promise<ResearchResult> {
  // Build optional niche block. Skip for scaffold niches — their research
  // fields are 'TODO' placeholders and would just add noise to the prompt.
  const niche = options?.niche ? getNiche(options.niche) : null;
  const nicheBlock = niche && niche.status === 'live'
    ? `

NICHE CONTEXT — this prospect is in the ${niche.label} vertical.

Extract pain points with this focus:
${niche.research.painPointFocus}

Strong-fit signals to look for:
${niche.research.qualifyingSignals.map((s) => `- ${s}`).join('\n')}

Disqualifying signals — if you see any of these, prefix \`outreach_angle\` with "DISQUALIFIED: <reason>" and return empty pain_points:
${niche.research.disqualifyingSignals.map((s) => `- ${s}`).join('\n')}
`.trim()
    : '';

  const userContent = [
    `Company: ${companyName}`,
    `URL: ${companyUrl}`,
    nicheBlock ? `\n${nicheBlock}\n` : '',
    `Website content:\n${pageContent.slice(0, 30000)}`,
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: RESEARCHER_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```\s*$/, '');

  return JSON.parse(cleaned);
}

// ─── Niche auto-detection ─────────────────────────────────────────────────
//
// Scores every registered niche against the prospect's website content + URL.
// Returns a winning slug only if it's BOTH meaningfully strong (score >= 5)
// AND clearly ahead of the runner-up (>= 2x). Otherwise returns null so the
// caller can leave `prospects.niche` NULL and the composer falls back to
// the generic prompt.
//
// Caller responsibilities:
// - Never overwrite a manually-set niche. Only write when current is NULL.
// - Run this AFTER fetching the company website but BEFORE the main research call,
//   so the research prompt can be niche-aware on first pass.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectNiche(websiteText: string, websiteUrl: string): string | null {
  const text = (websiteText || '').toLowerCase();
  const url = (websiteUrl || '').toLowerCase();

  const scores: Record<string, number> = {};

  for (const niche of listNiches()) {
    let score = 0;

    for (const kw of niche.detection.keywords) {
      // Word-boundary match. Multi-char/specific phrases weight 2x.
      const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'g');
      const matches = (text.match(re) || []).length;
      score += matches * (kw.length > 8 ? 2 : 1);
    }

    for (const hint of niche.detection.domainHints) {
      if (url.includes(hint)) score += 3;
    }

    scores[niche.slug] = score;
  }

  // Pick winner only if clearly ahead
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const [topSlug, topScore] = sorted[0] ?? ['', 0];
  const [, secondScore] = sorted[1] ?? ['', 0];

  if (topScore >= 5 && topScore >= secondScore * 2) {
    return topSlug;
  }
  return null;
}
