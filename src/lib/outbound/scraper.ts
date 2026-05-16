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
- For single-company pages, ALWAYS return one prospect — the company that owns the page
- For directories, extract all listed companies
- contact_email/contact_name only if actually visible on page — never fabricate
- Return [] only if the page has no business content at all (e.g., a 404 page, a login screen)
- company_url must be a full URL with https://`;

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
