/**
 * Composer — writes two types of drafts:
 *
 * 1. composeGigSuggestion: branded email TO THE ARTIST suggesting a scraped gig.
 *    Friendly, warm. Includes match reasoning and the gig details.
 *
 * 2. composeVenuePitch: plain-text cold email TO A VENUE pitching the artist.
 *    Short, founder-to-booker tone. References venue specifics from research.
 */

import { anthropic, MODEL } from '../anthropic';
import type { BookerArtist, BookerGig, BookerVenue } from './types';

// ─── Gig suggestion to artist ────────────────────────────────────

const GIG_SUGGESTION_SYSTEM = `You are drafting an email from BLVBooker to one of the artists on our roster, suggesting a scraped gig opportunity.

Voice: friendly, professional, like a booking agent who's done their homework. Address the artist by first name. Be concise.

Rules:
- 80-150 words
- Reference SPECIFIC details from the gig (venue, date, pay, requirements)
- Briefly state why you think it fits them (one line)
- Tell them how to respond: just reply yes/no to this email
- Sign as "The BLVBooker team" (signature line gets appended automatically)

Output TWO things separated by "---":
1. Subject line (under 60 chars)
2. Email body

Example format:
gig opportunity: [venue name] [date]
---
Hey [first name],

[email body here]

Reply yes if you want me to pitch you for it.

— BLVBooker`;

// ─── Venue pitch ──────────────────────────────────────────────────

const VENUE_PITCH_SYSTEM = `You are drafting a cold pitch email from BLVBooker to a venue booking manager, on behalf of one of our artists.

Voice: confident, direct, founder-to-booker. Plain text only, no HTML. No corporate fluff.

Rules:
- 60-100 words MAX
- Reference ONE specific thing about the venue (from research): a recent event, their style, their programming gap
- Position the artist concisely: who they are, what they bring, why they fit THIS venue
- ONE clear ask: "open to discussing a date?" or "want to send a press kit?"
- No "I hope this finds you well." No exclamation marks. No emojis.
- Sign as the artist's stage name (or our team if no stage name)

Output TWO things separated by "---":
1. Subject line (under 50 chars, lowercase, no clickbait)
2. Email body`;

export interface ComposeResult {
  subject: string;
  body: string;
}

function parseComposerOutput(text: string): ComposeResult {
  const parts = text.split(/\n---\n/);
  if (parts.length >= 2) {
    return {
      subject: parts[0].trim(),
      body: parts.slice(1).join('\n---\n').trim(),
    };
  }
  // Fallback
  const lines = text.split('\n').filter(Boolean);
  return {
    subject: lines[0]?.trim() ?? 'opportunity',
    body: lines.slice(1).join('\n').trim(),
  };
}

export async function composeGigSuggestion(
  artist: BookerArtist,
  gig: BookerGig,
  reasoning: string
): Promise<ComposeResult> {
  const firstName = artist.stage_name?.split(' ')[0] ?? artist.name?.split(' ')[0] ?? 'there';

  const userPrompt = `ARTIST: ${artist.stage_name ?? artist.name ?? 'unknown'} (first name: ${firstName})

GIG:
${JSON.stringify(
  {
    title: gig.title,
    venue_name: gig.venue_name,
    city: gig.city,
    region: gig.region,
    gig_date: gig.gig_date,
    pay_amount: gig.pay_amount,
    pay_text: gig.pay_text,
    requirements: gig.requirements,
  },
  null,
  2
)}

WHY IT FITS (matcher reasoning):
${reasoning}

Draft the suggestion email.`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: GIG_SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  return parseComposerOutput(text);
}

export async function composeVenuePitch(
  artist: BookerArtist,
  venue: BookerVenue
): Promise<ComposeResult> {
  const artistName = artist.stage_name ?? artist.name ?? 'our artist';

  const userPrompt = `ARTIST WE'RE PITCHING:
${JSON.stringify(
  {
    name: artistName,
    performer_type: artist.performer_type,
    genres: artist.genres,
    city: artist.city,
    bio: artist.bio?.slice(0, 500),
    press_kit_url: artist.press_kit_url,
    demo_url: artist.demo_url,
  },
  null,
  2
)}

VENUE:
${JSON.stringify(
  {
    name: venue.name,
    venue_type: venue.venue_type,
    city: venue.city,
    booking_angle: venue.ai_research?.booking_angle,
    fit_genres: venue.ai_research?.fit_genres,
    summary: venue.ai_research?.summary,
  },
  null,
  2
)}

Draft the cold pitch.`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: VENUE_PITCH_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  return parseComposerOutput(text);
}
