/**
 * Researcher — reads a venue's website (homepage + booking/contact subpages)
 * and returns booking-focused analysis. The output is the operator's pitch
 * intel: who books, how to reach them, what they actually program, and where
 * the gaps are.
 */

import { anthropic, MODEL } from '../anthropic';
import type { VenueResearch } from './types';

const RESEARCHER_SYSTEM = `You are a venue research agent for BLVBooker, a service that books performers (DJs, rappers, singers, bands, musicians, poets, visual artists) into venues.

You will be given combined text content from a venue's homepage AND any booking/contact subpages we could find. Your job is to extract everything an operator needs to secure a booking.

Output ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "summary": "1-2 sentences on what this venue does and their event programming",
  "books_live_talent": "yes|no|unclear",
  "accepting_submissions": true|false,
  "submission_url": "string|null (direct link to a booking/EPK submission page if found)",
  "submission_method": "string|null (email | online form | EPK platform | agent only | walk-in)",
  "lead_time": "string|null (e.g. 'books 4-6 weeks out', '3 months ahead')",

  "recurring_nights": ["string", ...],
  "dead_nights": ["string", ...],
  "past_acts": ["string", ...],
  "genres_booked": ["string", ...],
  "fit_genres": ["string", ...],

  "pay_structure": "string|null (door deal | guarantee | tips only | unpaid | unknown)",
  "typical_cover": "string|null (e.g. '$10 cover', 'free entry')",
  "ticketed": true|false|null,
  "capacity": "integer|null",
  "age_policy": "string|null (21+ | 18+ | all ages | varies)",

  "has_pa": true|false|null,
  "has_dj_booth": true|false|null,
  "stage_size_notes": "string|null",

  "talent_buyer_name": "string|null",
  "talent_buyer_title": "string|null",
  "booking_email": "string|null",
  "booking_phone": "string|null",
  "booking_contact_name": "string|null (the person to address the pitch to — usually same as talent_buyer_name)",

  "pain_points": "string (one paragraph — what's missing or weak in their booking; reference specifics)",
  "booking_angle": "string (the single strongest reason to pitch them — one sentence)",
  "contact_hint": "string|null (kept for back-compat — booking email or page URL)"
}

Rules:
- Only report info actually visible on the page text. NEVER fabricate.
- For emails, prefer ones near words like "book", "talent", "events", "performers" over generic info@/sales@.
- "recurring_nights" = days/series with consistent programming (e.g. "Open Mic Wednesdays", "Jazz Sunday", "DJ Friday/Saturday").
- "dead_nights" = days with no apparent programming — these are pitch opportunities. Infer from gaps in the schedule, not from explicit "closed" mentions.
- "past_acts" = 3-5 specific artist names mentioned on the site (event archive, photos, "as featured" — use them for social-proof pitching).
- "books_live_talent": "yes" if they clearly program live performance; "no" if it's a venue type that doesn't (e.g. a coffee shop with only background music); "unclear" if you can't tell.
- "accepting_submissions": true ONLY if you see an explicit booking form, EPK link, "book us" page, or submission email. Default false.
- "fit_genres" = a curated subset of genres_booked that this venue would actually be receptive to (your judgment).
- If the site is too thin to analyze, set everything to null/false/[] and put "Site too thin to analyze" in summary.
- Reference SPECIFIC things from the site, not generic observations.`;

const SUBPAGES_TO_TRY = [
  '/booking',
  '/book',
  '/contact',
  '/contact-us',
  '/events',
  '/private-events',
  '/talent',
  '/submit',
  '/epk',
  '/book-us',
  '/about',
];

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BLVBooker/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function researchVenue(
  venueName: string,
  websiteUrl: string
): Promise<{ research: VenueResearch | null; error?: string }> {
  // 1) Fetch homepage
  const homepageHtml = await fetchHtml(websiteUrl);
  if (!homepageHtml) {
    return { research: null, error: `Failed to fetch ${websiteUrl}` };
  }

  // 2) Try a small set of booking/contact subpages — best-effort, skip 404s.
  let origin: string;
  try {
    origin = new URL(websiteUrl).origin;
  } catch {
    return { research: null, error: `Invalid URL: ${websiteUrl}` };
  }

  const subpageFetches = await Promise.all(
    SUBPAGES_TO_TRY.map(async (path) => {
      const url = origin + path;
      const html = await fetchHtml(url);
      return html ? { url, text: stripHtml(html) } : null;
    })
  );

  // 3) Combine homepage + subpages into a single payload.
  const homepageText = stripHtml(homepageHtml);
  const subpageBlocks = subpageFetches
    .filter((s): s is { url: string; text: string } => s !== null && s.text.length > 200)
    .map((s) => `\n\n--- SUBPAGE: ${s.url} ---\n${s.text.slice(0, 8000)}`)
    .join('');

  const combinedText = `--- HOMEPAGE: ${websiteUrl} ---\n${homepageText.slice(0, 20000)}${subpageBlocks}`;

  if (combinedText.length < 600) {
    return {
      research: {
        summary: 'Site too thin to analyze (likely JS-rendered)',
        books_live_talent: 'unclear',
        accepting_submissions: false,
      },
      error: 'thin_content',
    };
  }

  // 4) Send to Claude.
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: RESEARCHER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Venue: ${venueName}\nWebsite: ${websiteUrl}\n\n${combinedText.slice(0, 60000)}`,
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

    const research = JSON.parse(cleaned) as VenueResearch;
    return { research };
  } catch (err: any) {
    console.error(`[booker-researcher] error: ${err?.message ?? 'unknown'}`);
    return { research: null, error: 'AI research failed' };
  }
}
