/**
 * Matcher — scores an opportunity (gig or venue) against an artist profile.
 * Returns 0-100 score + one-line reasoning.
 *
 * Only matches above match_threshold (booker_settings) should surface to the operator.
 */

import { anthropic, MODEL } from '../anthropic';
import type { BookerArtist, BookerGig, BookerVenue } from './types';

const MATCHER_SYSTEM = `You score the fit between an artist (DJ, rapper, singer, band, musician, poet, or visual artist) and an opportunity (a scraped gig posting OR a venue we'd pitch them to).

Output ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "score": 0-100,
  "reasoning": "one-line rationale referencing specific fit/mismatch points"
}

Scoring rubric:
- 90-100: Strong fit. Genre + city + pay + format + audience all align.
- 70-89: Solid fit. Most criteria align; minor concerns.
- 50-69: Plausible fit. Some signal but real concerns (mismatched genre, marginal pay, distance).
- 0-49: Poor fit. Wrong vertical, wrong city beyond travel radius, hard-no triggers, etc.

Hard zero (score 0) if:
- Vertical mismatch (e.g., poet pitched a DJ gig)
- Contains a stated hard-no
- Outside travel radius
- Pay below rate_floor

Reasoning must be concrete: "Genre match (techno), in-city, but date conflicts with availability_notes" — not "good fit."`;

interface MatchScore {
  score: number;
  reasoning: string;
}

export async function scoreGigMatch(
  artist: BookerArtist,
  gig: BookerGig
): Promise<MatchScore> {
  const userPrompt = `ARTIST PROFILE:
${JSON.stringify(
  {
    performer_type: artist.performer_type,
    genres: artist.genres,
    city: artist.city,
    region: artist.region,
    travel_radius_mi: artist.travel_radius_mi,
    rate_floor: artist.rate_floor,
    gig_types: artist.gig_types,
    availability_notes: artist.availability_notes,
    hard_nos: artist.hard_nos,
    bio: artist.bio?.slice(0, 400),
  },
  null,
  2
)}

GIG OPPORTUNITY:
${JSON.stringify(
  {
    vertical: gig.vertical,
    title: gig.title,
    venue_name: gig.venue_name,
    city: gig.city,
    region: gig.region,
    gig_date: gig.gig_date,
    pay_amount: gig.pay_amount,
    pay_text: gig.pay_text,
    requirements: gig.requirements,
    normalized: gig.ai_normalized,
  },
  null,
  2
)}

Score the match.`;

  return runMatcher(userPrompt);
}

export async function scoreVenueMatch(
  artist: BookerArtist,
  venue: BookerVenue
): Promise<MatchScore> {
  const userPrompt = `ARTIST PROFILE:
${JSON.stringify(
  {
    performer_type: artist.performer_type,
    genres: artist.genres,
    city: artist.city,
    region: artist.region,
    travel_radius_mi: artist.travel_radius_mi,
    rate_floor: artist.rate_floor,
    gig_types: artist.gig_types,
    availability_notes: artist.availability_notes,
    hard_nos: artist.hard_nos,
    bio: artist.bio?.slice(0, 400),
  },
  null,
  2
)}

VENUE OPPORTUNITY:
${JSON.stringify(
  {
    name: venue.name,
    venue_type: venue.venue_type,
    city: venue.city,
    region: venue.region,
    verticals: venue.verticals,
    genres_pref: venue.genres_pref,
    capacity: venue.capacity,
    research: venue.ai_research,
  },
  null,
  2
)}

Score the fit between this artist and pitching them to this venue.`;

  return runMatcher(userPrompt);
}

async function runMatcher(userPrompt: string): Promise<MatchScore> {
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: MATCHER_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
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
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 0))),
      reasoning: parsed.reasoning ?? '',
    };
  } catch (err: any) {
    console.error(`[booker-matcher] error: ${err?.message ?? 'unknown'}`);
    return { score: 0, reasoning: 'Matcher failed' };
  }
}
