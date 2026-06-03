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
- For booking_email: an EMAIL CANDIDATES list is appended below the page text, pre-ranked best-to-worst for booking relevance. Pick the BEST candidate from that list — usually the first one. If the top candidate is generic (info@, hello@, contact@) and there's nothing better, USE IT — info@ is better than null because it's at least a real channel. Only return null if the list is empty.
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
  '/book-us',
  '/contact',
  '/contact-us',
  '/events',
  '/private-events',
  '/private-event',
  '/host-event',
  '/host-an-event',
  '/parties',
  '/weddings',
  '/buyout',
  '/talent',
  '/submit',
  '/submissions',
  '/epk',
  '/about',
  '/info',
  '/inquire',
  '/inquiries',
];

/**
 * Pull all email addresses out of raw text, rank by likely booking relevance,
 * and return the top candidates. This is fed to Claude as a HINT — Claude
 * may still pick differently or return null if no email is real.
 *
 * Common obfuscations handled: " [at] ", " (at) ", " {at} ", " AT ".
 */
function extractEmailCandidates(text: string): string[] {
  // Normalize common obfuscations into real @
  const normalized = text
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s*\{\s*at\s*\}\s*/gi, '@')
    .replace(/\s+at\s+(?=[a-z0-9-]+\.[a-z]{2,})/gi, '@');

  const matches = normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];

  // Dedup + lowercase + filter known junk
  const junkPatterns = [
    /^[a-z]+@example\./,
    /^email@/,
    /@sentry\.io$/i,
    /@wixpress\.com$/i,
    /@sentry\./i,
    /\.png$|\.jpg$|\.svg$/i, // file paths sneaking in
    /^no-?reply@/i,
    /^donotreply@/i,
    /^postmaster@/i,
    /^abuse@/i,
  ];
  const unique = [...new Set(matches.map((e) => e.toLowerCase()))]
    .filter((e) => !junkPatterns.some((p) => p.test(e)));

  // Rank by booking relevance
  const score = (email: string): number => {
    const local = email.split('@')[0];
    if (/^(book|booking|bookings|talent|events?|programming|gig|gigs|venue|venues)/.test(local)) return 5;
    if (/^(private|hire|host|buyout|inquir)/.test(local)) return 4;
    if (/^(manager|gm|owner|general|director)/.test(local)) return 3;
    if (/^(info|hello|contact|hi|reach)/.test(local)) return 2;
    return 1;
  };
  unique.sort((a, b) => score(b) - score(a));
  return unique.slice(0, 8);
}

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

/**
 * Parse homepage HTML for internal <a> links whose href OR visible text
 * suggests a contact / booking / events page. Returns absolute URLs.
 *
 * This is the FIX for "contact page not searched" — instead of guessing
 * paths like /contact, /contact-us, we read what the site actually
 * links to (e.g. /contact.html, /reach-us, /get-in-touch).
 */
function discoverBookingLinks(html: string, origin: string): string[] {
  const RELEVANT = /(contact|book|event|private|host|part(y|ies)|wedding|talent|submit|epk|inquir|reach|info|reservation|reserve|hire|buyout|find\s*us|get\s*in\s*touch)/i;
  const STATIC_EXT = /\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|webp|mp4|mp3)(\?|$)/i;
  const found = new Set<string>();
  // Match <a href="..." > text </a> (greedy on text, simple but works)
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const rawHref = m[1].trim();
    const linkText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) continue;
    if (STATIC_EXT.test(rawHref)) continue;
    if (!RELEVANT.test(rawHref) && !RELEVANT.test(linkText)) continue;

    let absolute: string;
    try {
      absolute = new URL(rawHref, origin).toString();
    } catch {
      continue;
    }
    // Same-origin only — don't follow links to external booking platforms
    // (those are stored separately as submission_url by Claude)
    try {
      if (new URL(absolute).origin !== origin) continue;
    } catch {
      continue;
    }
    // Strip URL fragments + trailing slashes for dedup
    const normalized = absolute.split('#')[0].replace(/\/$/, '');
    found.add(normalized);
  }
  return [...found].slice(0, 15); // cap so research doesn't take forever
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

  // 2) Two-pronged subpage discovery:
  //    (a) Parse the homepage HTML for actual booking/contact links the site
  //        publishes — catches /contact.html, /reach-us, /get-in-touch, etc.
  //    (b) Try a hardcoded fallback list for sites that don't link to their
  //        own contact page from the homepage (rare but happens).
  let origin: string;
  try {
    origin = new URL(websiteUrl).origin;
  } catch {
    return { research: null, error: `Invalid URL: ${websiteUrl}` };
  }

  const discovered = discoverBookingLinks(homepageHtml, origin);
  const fallback = SUBPAGES_TO_TRY.map((p) => origin + p);
  // Dedup, cap at 20 to keep fetch fanout reasonable
  const allUrls = [...new Set([...discovered, ...fallback])].slice(0, 20);

  const subpageFetches = await Promise.all(
    allUrls.map(async (url) => {
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

  // 4) Pre-extract email candidates as a HINT for Claude. This catches
  // emails in awkward places (footer, About page, image alt text leftovers)
  // and de-obfuscates "[at]" / "(at)" formats Claude often misses.
  const emailCandidates = extractEmailCandidates(combinedText);
  const emailHint = emailCandidates.length > 0
    ? `\n\n--- EMAIL CANDIDATES FOUND ON PAGE (ranked best→worst for booking; pick the most relevant for booking_email, or null if none look real): ---\n${emailCandidates.join('\n')}`
    : '\n\n--- NO EMAILS FOUND ON PAGE ---\nSet booking_email to null. Look for a booking form, EPK link, or external submission method instead.';

  // Send to Claude.
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: RESEARCHER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Venue: ${venueName}\nWebsite: ${websiteUrl}\n\n${combinedText.slice(0, 60000)}${emailHint}`,
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
