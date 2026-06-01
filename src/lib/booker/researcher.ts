/**
 * Researcher — reads a venue's website and returns booking-focused analysis:
 * pain points, booking angle, contact hints, fit genres.
 */

import { anthropic, MODEL } from '../anthropic';
import type { VenueResearch } from './types';

const RESEARCHER_SYSTEM = `You are a venue research agent for BLVBooker, a service that books performers (DJs, musicians, poets, visual artists, bands) into venues.

Given a venue's website content, identify:
- What kind of performers they book (genres, styles)
- Booking pain points (e.g. lots of dead nights, no consistent booking pipeline, generic talent quality)
- The strongest angle to pitch them
- Specific booking-related contact info found

Output ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "summary": "1-2 sentences on what this venue does and their event programming",
  "fit_genres": ["string", ...],
  "pain_points": "string (one paragraph — what's missing or weak in their booking)",
  "booking_angle": "string (the single strongest reason to pitch them — one sentence)",
  "contact_hint": "string|null (booking email or page URL if found, e.g. 'booking@venue.com' or '/booking-inquiries')"
}

Rules:
- Only report contact info actually visible on the page — never fabricate
- If the site is too thin to analyze, return everything as null/empty and put "Site too thin to analyze" in summary
- Reference SPECIFIC things from the site (event series names, past acts, programming gaps), not generic observations`;

export async function researchVenue(
  venueName: string,
  websiteUrl: string
): Promise<{ research: VenueResearch | null; error?: string }> {
  // Fetch the venue's website
  let html = '';
  try {
    const res = await fetch(websiteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BLVBooker/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return { research: null, error: `HTTP ${res.status} fetching ${websiteUrl}` };
    }

    html = await res.text();
  } catch (err: any) {
    return { research: null, error: `Fetch failed: ${err?.message ?? 'unknown'}` };
  }

  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (textContent.length < 600) {
    return {
      research: { summary: 'Site too thin to analyze (likely JS-rendered)' },
      error: 'thin_content',
    };
  }

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: RESEARCHER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Venue: ${venueName}\nURL: ${websiteUrl}\n\nWebsite content:\n${textContent.slice(0, 30000)}`,
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
