/**
 * Build A — scraper.
 * Fetches a public posting URL (Craigslist /gigs first), extracts gig postings
 * via Claude. Writes nothing to DB — caller (engine) inserts into booker_gigs.
 */

import { anthropic, MODEL } from '../anthropic';
import type { GigVertical } from './types';

const SCRAPER_SYSTEM = `You are a gig-posting extraction agent for BLVBooker, a service that books performers (DJs, musicians, poets, visual artists, bands).

You will be given the text content of a web page (likely a Craigslist /gigs index, Patch community board, an Eventbrite organizer page, or a poetry/events calendar).

Your job is to extract EXPLICIT "performer wanted" postings — gigs where the poster is actively looking for someone to perform.

For each posting, extract a structured record. Only return real, current postings. Skip:
- Spam, scams, or off-topic posts
- Postings looking for DJ services to hire (where the poster IS the venue offering work)
- Postings where someone is selling DJ/music gear or services unrelated to booking a performer

Wait — actually for our purposes:
- "DJ wanted for wedding" = real gig (KEEP)
- "DJ services for hire" = wrong direction (SKIP)
- "Open mic this Friday" = real gig opportunity (KEEP if performers can sign up)
- "Band needed for festival" = real gig (KEEP)

Output ONLY valid JSON array. No preamble, no markdown fences. Schema:
[
  {
    "title": "string — short, descriptive",
    "vertical": "dj|musician|poet|visual_artist|band|any",
    "venue_name": "string|null",
    "city": "string|null",
    "region": "string|null (state/province)",
    "gig_date": "YYYY-MM-DD|null",
    "pay_text": "string|null (raw, e.g. '$300 + tips')",
    "pay_amount": "integer|null (whole dollars if extractable)",
    "requirements": "string|null",
    "contact_email": "string|null",
    "contact_method": "string|null (e.g. 'reply through Craigslist', 'phone: 555-555-5555')",
    "source_url": "string|null (direct link to the specific posting if available)",
    "raw_text": "string (the original posting text, ~300 chars max)"
  }
]

If the page has no extractable gig postings, return [].

Rules:
- Don't fabricate contact emails, URLs, or dates
- vertical = "any" if the posting allows multiple performer types
- Cap at 50 postings per page; pick the most actionable if more exist`;

export interface ScrapedGig {
  title: string | null;
  vertical: GigVertical | null;
  venue_name: string | null;
  city: string | null;
  region: string | null;
  gig_date: string | null;
  pay_text: string | null;
  pay_amount: number | null;
  requirements: string | null;
  contact_email: string | null;
  contact_method: string | null;
  source_url: string | null;
  raw_text: string;
}

/**
 * Fetch a URL and extract gig postings.
 * Returns [] if the page is JS-rendered (too thin), unreachable, or has no gigs.
 */
export async function scrapeGigSource(
  url: string,
  maxResults = 30
): Promise<{ gigs: ScrapedGig[]; error?: string }> {
  // Fetch the URL
  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BLVBooker/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return { gigs: [], error: `HTTP ${res.status} fetching ${url}` };
    }

    html = await res.text();
  } catch (err: any) {
    return { gigs: [], error: `Fetch failed: ${err?.message ?? 'unknown'}` };
  }

  // Strip HTML
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (textContent.length < 600) {
    return {
      gigs: [],
      error: 'Page appears JS-rendered or too thin to extract',
    };
  }

  // Run extractor
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SCRAPER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Source URL: ${url}\n\nMaximum postings to extract: ${maxResults}. Pick the most actionable.\n\nPage content:\n${textContent.slice(0, 40000)}`,
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

    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed.slice(0, maxResults) : [];
    return { gigs: arr };
  } catch (err: any) {
    console.error(`[booker-scraper] error: ${err?.message ?? 'unknown'}`);
    return { gigs: [], error: 'AI extraction failed' };
  }
}
