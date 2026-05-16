/**
 * Scraper agent — reads a URL (directory, blog post, company list)
 * and extracts prospect companies with contact info.
 */

import { anthropic, MODEL } from '../anthropic';

const SCRAPER_SYSTEM = `You are a prospect extraction agent for BLVSTACK, an AI systems studio.

You will be given the text content of a web page. Your job is to extract potential business prospects.

**Two scenarios:**

1. **Directory / list page** (e.g., "Top 10 marketing agencies", a startup directory, a "Our portfolio companies" page): Extract every company listed.

2. **Single company page** (e.g., one business's homepage, about page, or contact page): Treat the page itself as ONE prospect. Extract that company's info from the page.

For each prospect, extract:
- company_name: the business name (required)
- company_url: their website URL — for single-company pages, use the source URL provided
- contact_name: founder/CEO/decision-maker name (if mentioned)
- contact_email: their email (if visible on page)
- context: one sentence about what they do or why they're a prospect

Output ONLY valid JSON array. No preamble, no markdown fences. Example:
[
  {
    "company_name": "Acme Corp",
    "company_url": "https://acme.com",
    "contact_name": "Jane Smith",
    "contact_email": "jane@acme.com",
    "context": "Marketing agency scaling content production"
  }
]

Rules:
- For directories with visible listings: extract every company that has an actual name and URL/profile visible
- For single-company pages with clear business content (services described, team mentioned, products listed): return one prospect for that company
- contact_email/contact_name only if actually visible on page — NEVER fabricate
- company_url must be a full URL with https://
- Return [] if:
  • The page has no substantive business content (mostly nav/footer/JS placeholders)
  • You can't tell what business this page is about
  • The "business" appears to be a directory/aggregator itself (skip those — extract their LISTINGS, not the directory)
- A page mentioning a business name in passing (e.g., a "best of" article that just lists names without details) is fine to extract
- Do NOT return the directory site itself as a prospect when looking at a directory page`;

export interface ScrapedProspect {
  company_name: string;
  company_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  context: string;
}

export async function scrapeUrl(
  url: string,
  pageContent: string,
  maxResults = 20,
  alreadyExtracted: string[] = []
): Promise<ScrapedProspect[]> {
  const skipNote = alreadyExtracted.length > 0
    ? `\n\nIMPORTANT: The following companies have ALREADY been extracted from this URL in previous runs. Do NOT include them again — pick different ones:\n${alreadyExtracted.map((n) => `- ${n}`).join('\n')}\n`
    : '';

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SCRAPER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Source URL: ${url}\n\nMaximum prospects to extract: ${maxResults}. If the page lists more than ${maxResults}, pick the ${maxResults} most promising ones based on relevance/seniority.${skipNote}\n\nPage content:\n${pageContent.slice(0, 30000)}`,
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
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.slice(0, maxResults) : [];
  } catch {
    console.error('[scraper] Failed to parse response:', text.slice(0, 200));
    return [];
  }
}
