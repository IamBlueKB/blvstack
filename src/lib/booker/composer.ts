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

const VENUE_PITCH_SYSTEM = `You are BLVBooker — a boutique booking agency. You're drafting a cold pitch email to a venue's booking contact, on behalf of one specific artist on our roster.

The pitch must be a FUNCTION OF (this artist's profile) × (this specific venue's data). NOT a template with a name swapped in. Lead emphasis SHIFTS based on the venue_type:

- venue_type = "private_events" (wedding venue, banquet hall, hotel event space, event restaurant) → LEAD with the artist's wedding/private-event fit. Reference their gig_types if 'weddings' or 'private' or 'corporate' is in there.
- venue_type = "club" (nightclub) → LEAD with the artist's genre/club fit. Reference their genres + the venue's vibe.
- venue_type = "bar" (lounge, brewery, winery, sports bar) → LEAD with the recurring-slot or theme-night angle. Reference availability_notes if any.
- venue_type = "restaurant" → LEAD with the recurring-night angle (brunch DJ, happy hour, etc).
- Any other venue_type → match the most relevant gig_type from the artist's profile to the venue.

ABSOLUTE RULES:
- 3 to 5 sentences total. Hard cap.
- Open with ONE specific reference to THIS venue, pulled from the venue's ai_research (summary, booking_angle, past_acts, recurring_nights, fit_genres, genres_booked, vibe). It must be obvious you looked at THIS venue, not a blast.
- Position the artist in ONE sentence using their stage_name + most relevant profile fields (performer_type, genres, gig_types, bio highlight).
- Include exactly ONE link — the artist's BEST demo or social for this venue context (a club venue gets their soundcloud/mix; a wedding venue gets a polished demo or IG with weddings; a restaurant gets a chill-set link).
- ONE clear soft ask: "open to a quick chat about a date?" or "happy to send a quick demo if you want to hear" — never demanding.
- DO NOT state the artist's rate, price, or pay. Use rate_floor/rate_notes internally as a FIT QUALIFIER only — if the venue clearly pays under the artist's floor, DON'T mention it, but skip mentioning price.
- Respect the artist's hard_nos. If their hard_nos list this venue_type or genre, write the pitch WITHOUT misrepresenting them.
- Voice: quiet confidence, no hype, no scarcity language, no exclamation marks, no emojis, no "I hope this finds you well", no "just reaching out", no "wanted to drop a quick note", no "circling back".
- Sign as "— BLVBooker" on its own line at the end. Not the artist's name. We are the agency.

Output TWO things separated by "---":
1. Subject line (under 50 chars, lowercase, no hype words, no clickbait, mentions the artist or the venue specifically)
2. Email body — plain text, 3-5 sentences, one link inline, signed "— BLVBooker"`;

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

/**
 * Pick the single best link to include in a venue pitch, given venue_type.
 * Returns null if the artist has no usable link.
 */
function pickBestLinkForVenue(
  artist: BookerArtist,
  venueType: string | null | undefined
): { url: string; label: string } | null {
  const socials = artist.social_links ?? {};
  const vt = (venueType ?? '').toLowerCase();

  // Club / bar (DJ-leaning) → prefer soundcloud / mix / spotify
  if (vt === 'club' || vt === 'bar') {
    if (socials.soundcloud) return { url: socials.soundcloud, label: 'soundcloud' };
    if (socials.spotify) return { url: socials.spotify, label: 'spotify' };
    if (artist.demo_url) return { url: artist.demo_url, label: 'demo' };
    if (socials.instagram) return { url: socials.instagram, label: 'instagram' };
  }

  // Private events / wedding / hotel / restaurant → prefer polished demo or IG
  if (vt === 'private_events' || vt === 'restaurant' || vt === 'corporate') {
    if (artist.demo_url) return { url: artist.demo_url, label: 'demo' };
    if (socials.instagram) return { url: socials.instagram, label: 'instagram' };
    if (artist.press_kit_url) return { url: artist.press_kit_url, label: 'press kit' };
    if (socials.youtube) return { url: socials.youtube, label: 'youtube' };
  }

  // Theater / gallery / college / coffeehouse → press kit or polished demo
  if (vt === 'theater' || vt === 'gallery' || vt === 'college' || vt === 'coffeehouse' || vt === 'library') {
    if (artist.press_kit_url) return { url: artist.press_kit_url, label: 'press kit' };
    if (artist.demo_url) return { url: artist.demo_url, label: 'demo' };
    if (socials.youtube) return { url: socials.youtube, label: 'youtube' };
    if (socials.instagram) return { url: socials.instagram, label: 'instagram' };
  }

  // Generic fallback order
  return (
    (artist.demo_url && { url: artist.demo_url, label: 'demo' }) ||
    (socials.soundcloud && { url: socials.soundcloud, label: 'soundcloud' }) ||
    (socials.spotify && { url: socials.spotify, label: 'spotify' }) ||
    (socials.instagram && { url: socials.instagram, label: 'instagram' }) ||
    (artist.press_kit_url && { url: artist.press_kit_url, label: 'press kit' }) ||
    null
  );
}

export async function composeVenuePitch(
  artist: BookerArtist,
  venue: BookerVenue
): Promise<ComposeResult> {
  const artistName = artist.stage_name ?? artist.name ?? 'our artist';
  const bestLink = pickBestLinkForVenue(artist, venue.venue_type);

  // Internal fit qualifier — do NOT surface price in the pitch itself.
  const internalFit = {
    artist_rate_floor: artist.rate_floor,
    artist_rate_notes: artist.rate_notes,
    artist_hard_nos: artist.hard_nos,
    venue_pay_structure: venue.ai_research?.pay_structure ?? null,
    venue_typical_cover: venue.ai_research?.typical_cover ?? null,
  };

  const userPrompt = `ARTIST PROFILE (full — use everything relevant):
${JSON.stringify(
  {
    stage_name: artist.stage_name,
    name: artist.name,
    performer_type: artist.performer_type,
    performer_types: artist.performer_types,
    genres: artist.genres,
    city: artist.city,
    region: artist.region,
    travel_radius_mi: artist.travel_radius_mi,
    gig_types: artist.gig_types,
    availability_notes: artist.availability_notes,
    bio: artist.bio?.slice(0, 600),
    hard_nos: artist.hard_nos,
  },
  null,
  2
)}

ARTIST LINKS (do not list more than one — use only the BEST_LINK below):
${JSON.stringify(
  {
    demo_url: artist.demo_url,
    press_kit_url: artist.press_kit_url,
    social_links: artist.social_links,
  },
  null,
  2
)}

BEST_LINK to include in pitch (already chosen for this venue_type — use exactly this one URL):
${bestLink ? JSON.stringify(bestLink) : 'NONE — write the pitch without a link, end with the soft ask instead'}

VENUE (tailor the pitch to THIS venue):
${JSON.stringify(
  {
    name: venue.name,
    venue_type: venue.venue_type,
    city: venue.city,
    region: venue.region,
    capacity: venue.capacity,
    genres_pref: venue.genres_pref,
    contact_name: venue.contact_name,
    ai_research: venue.ai_research,
  },
  null,
  2
)}

INTERNAL FIT (DO NOT MENTION PRICE IN THE PITCH — this is for your own qualification only):
${JSON.stringify(internalFit, null, 2)}

Draft the cold pitch from BLVBooker. Lead emphasis must match venue_type per the rules. Use the BEST_LINK above as the single link. Address the contact_name if present, otherwise no greeting name. Sign "— BLVBooker".`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
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
