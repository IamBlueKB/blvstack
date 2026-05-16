/**
 * Researcher agent — reads a prospect's company website and identifies
 * specific pain points that BLVSTACK can solve.
 */

import { anthropic, MODEL } from '../anthropic';

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
  pageContent: string
): Promise<ResearchResult> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: RESEARCHER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Company: ${companyName}\nURL: ${companyUrl}\n\nWebsite content:\n${pageContent.slice(0, 30000)}`,
      },
    ],
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
