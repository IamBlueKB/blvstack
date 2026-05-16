/**
 * Scraper agent — reads a URL (directory, blog post, company list)
 * and extracts prospect companies with contact info.
 */

import { anthropic, MODEL } from '../anthropic';

const SCRAPER_SYSTEM = `You are a prospect extraction agent for BLVSTACK, an AI systems studio.

You will be given the text content of a web page. Your job is to extract potential business prospects — companies or founders who might need AI systems built.

For each prospect found on the page, extract:
- company_name: the business name
- company_url: their website URL (if mentioned or inferable)
- contact_name: founder/CEO/decision-maker name (if mentioned)
- contact_email: their email (if mentioned on the page)
- context: one sentence about what they do or why they might be a prospect

Output ONLY valid JSON array. No preamble, no markdown fences. Example:
[
  {
    "company_name": "Acme Corp",
    "company_url": "https://acme.com",
    "contact_name": "Jane Smith",
    "contact_email": "jane@acme.com",
    "context": "Marketing agency scaling content production, likely needs automation"
  }
]

If the page has no extractable prospects, return an empty array: []

Rules:
- Only extract real businesses, not ads or unrelated links
- If you see a list of companies (like a directory or "top X" article), extract all of them
- company_url must be a full URL if available, otherwise null
- contact_email must be a real email if visible, otherwise null
- Do NOT fabricate emails or URLs — only extract what's actually on the page`;

export interface ScrapedProspect {
  company_name: string;
  company_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  context: string;
}

export async function scrapeUrl(url: string, pageContent: string): Promise<ScrapedProspect[]> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SCRAPER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Source URL: ${url}\n\nPage content:\n${pageContent.slice(0, 30000)}`,
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

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error('[scraper] Failed to parse response:', text.slice(0, 200));
    return [];
  }
}
