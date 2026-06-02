/**
 * BLVBooker engine — orchestrates the operator workflow.
 *
 * Public API:
 *   runScrape(vertical) — Build A: fetches all active sources for a vertical,
 *                          extracts gigs, normalizes them, inserts into booker_gigs.
 *   runVenueBuild(query) — Build B: Google Places search → booker_venues inserts.
 *   runMatch() — score every (active artist) × (un-matched gig+venue) above match_threshold.
 *   sendToArtist(matchId) — drafts (if needed) + emails the artist a gig suggestion.
 *   pitchVenue(matchId) — drafts (if needed) + sends the venue pitch.
 *   runVenueFollowUps() — sends follow-up to pitched-but-no-reply venues.
 *   processInboundReply(senderEmail, subject, body) — webhook callback.
 *   processBounce(email) — webhook callback.
 */

import { supabaseAdmin } from '../supabase';
import { scrapeGigSource } from './scraper';
import { normalizeGig } from './normalizer';
import { searchVenues } from './places';
import { researchVenue } from './researcher';
import { scoreGigMatch, scoreVenueMatch } from './matcher';
import { composeGigSuggestion, composeVenuePitch } from './composer';
import { sendArtistEmail, sendVenuePitch, getAllBookerSettings } from './booker-email';
import type {
  BookerArtist,
  BookerGig,
  BookerVenue,
  GigVertical,
  Vertical,
} from './types';

// ─── Build A: Scrape vertical ─────────────────────────────────────

export async function runScrape(
  vertical: GigVertical,
  opts?: { maxGigs?: number }
): Promise<{
  sources_processed: number;
  gigs_inserted: number;
  reached_cap: boolean;
  errors: { url: string; error: string }[];
}> {
  // User-controlled count: how many real gigs to insert this run.
  // Default 10. Caller (UI) passes whatever number the operator picked.
  const maxGigs = opts?.maxGigs ?? 10;

  // Get active sources for this vertical (or 'any')
  const { data: sources } = await supabaseAdmin
    .from('booker_sources')
    .select('*')
    .eq('active', true)
    .in('vertical', vertical === 'any' ? ['any'] : [vertical, 'any']);

  if (!sources || sources.length === 0) {
    return { sources_processed: 0, gigs_inserted: 0, reached_cap: false, errors: [] };
  }

  // Walk sources oldest-scraped-first so we rotate through over multiple runs.
  sources.sort((a: any, b: any) => {
    const ta = a.last_scraped_at ? new Date(a.last_scraped_at).getTime() : 0;
    const tb = b.last_scraped_at ? new Date(b.last_scraped_at).getTime() : 0;
    return ta - tb;
  });

  let gigsInserted = 0;
  let sourcesProcessed = 0;
  let reachedCap = false;
  const errors: { url: string; error: string }[] = [];

  for (const source of sources) {
    // Stop as soon as we've inserted enough real gigs
    if (gigsInserted >= maxGigs) {
      reachedCap = true;
      break;
    }

    sourcesProcessed++;
    const { gigs, error } = await scrapeGigSource(source.url, 30);

    if (error) {
      errors.push({ url: source.url, error });
      await supabaseAdmin
        .from('booker_sources')
        .update({ last_scraped_at: new Date().toISOString(), last_result_count: 0 })
        .eq('id', source.id);
      continue;
    }

    // Dedup by source_url within this source
    const existing = new Set<string>();
    if (gigs.length > 0) {
      const { data: existingRows } = await supabaseAdmin
        .from('booker_gigs')
        .select('source_url')
        .eq('source_id', source.id)
        .not('source_url', 'is', null);
      for (const r of existingRows ?? []) {
        if (r.source_url) existing.add(r.source_url);
      }
    }

    const rows = gigs
      .filter((g) => !g.source_url || !existing.has(g.source_url))
      .map((g) => ({
        source: source.source_type,
        source_url: g.source_url ?? source.url,
        source_id: source.id,
        vertical: g.vertical ?? source.vertical,
        title: g.title,
        venue_name: g.venue_name,
        city: g.city ?? source.city,
        region: g.region ?? source.region,
        gig_date: g.gig_date,
        pay_text: g.pay_text,
        pay_amount: g.pay_amount,
        requirements: g.requirements,
        contact_email: g.contact_email,
        contact_method: g.contact_method,
        raw_text: g.raw_text,
        status: 'new',
      }));

    if (rows.length > 0) {
      const { data: inserted } = await supabaseAdmin
        .from('booker_gigs')
        .insert(rows)
        .select('id, raw_text, source_url, contact_email, venue_name');

      // Normalize each new gig
      for (const gig of inserted ?? []) {
        try {
          const normalized = await normalizeGig(gig.raw_text, {
            source_url: gig.source_url,
            contact_email: gig.contact_email,
            venue_name: gig.venue_name,
          });

          await supabaseAdmin
            .from('booker_gigs')
            .update({
              ai_normalized: normalized,
              status: normalized.is_real_gig ? 'normalized' : 'dead',
            })
            .eq('id', gig.id);

          if (normalized.is_real_gig) gigsInserted++;
        } catch (err: any) {
          console.error(`[booker-engine] normalize error for gig ${gig.id}:`, err);
        }
      }
    }

    await supabaseAdmin
      .from('booker_sources')
      .update({
        last_scraped_at: new Date().toISOString(),
        last_result_count: rows.length,
      })
      .eq('id', source.id);
  }

  return { sources_processed: sourcesProcessed, gigs_inserted: gigsInserted, reached_cap: reachedCap, errors };
}

// ─── Per-artist: scrape gigs + match for one artist ──────────────

/**
 * Runs scrape for an artist's verticals, then runs the matcher targeting
 * only that artist. Returns how many gigs were inserted and how many matches
 * were created for this artist.
 */
export async function runScrapeForArtist(
  artistId: string,
  opts?: { maxGigsPerVertical?: number }
): Promise<{
  artist_id: string;
  verticals: string[];
  gigs_inserted: number;
  matches_created: number;
  errors: any[];
}> {
  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', artistId)
    .is('deleted_at', null)
    .single();

  if (!artist) {
    return { artist_id: artistId, verticals: [], gigs_inserted: 0, matches_created: 0, errors: ['Artist not found'] };
  }

  // Pick the artist's verticals (multi-type array, fallback to single, fallback to 'any')
  const verticals: string[] = (artist.performer_types && artist.performer_types.length > 0)
    ? artist.performer_types
    : (artist.performer_type ? [artist.performer_type] : ['any']);

  const maxGigsPerVertical = opts?.maxGigsPerVertical ?? 10;

  let totalInserted = 0;
  const errors: any[] = [];

  console.log(`[find-gigs] START artist=${artistId} verticals=${verticals.join(',')} maxPerVertical=${maxGigsPerVertical}`);

  for (const v of verticals) {
    console.log(`[find-gigs] scraping vertical: ${v}`);
    try {
      const result = await runScrape(v as GigVertical, { maxGigs: maxGigsPerVertical });
      console.log(`[find-gigs]   → ${result.gigs_inserted} gigs from ${result.sources_processed} sources${result.reached_cap ? ' (cap reached)' : ''}`);
      totalInserted += result.gigs_inserted;
      if (result.errors?.length) errors.push(...result.errors);
    } catch (err: any) {
      errors.push({ vertical: v, error: err?.message ?? 'unknown' });
    }
  }

  // Now run matcher just for this artist against all normalized + unmatched gigs
  const settings = await getAllBookerSettings();
  const threshold = parseInt(settings.match_threshold ?? '70', 10);

  const { data: existingMatches } = await supabaseAdmin
    .from('booker_matches')
    .select('gig_id')
    .eq('artist_id', artistId)
    .eq('kind', 'gig');
  const existingGigIds = new Set((existingMatches ?? []).map((m: any) => m.gig_id));

  const { data: gigs } = await supabaseAdmin
    .from('booker_gigs')
    .select('*')
    .eq('status', 'normalized')
    .is('deleted_at', null);

  console.log(`[find-gigs] matching ${gigs?.length ?? 0} normalized gigs for this artist…`);
  let matches = 0;
  for (const gig of (gigs ?? []) as BookerGig[]) {
    if (existingGigIds.has(gig.id)) continue;

    try {
      const result = await scoreGigMatch(artist as BookerArtist, gig);
      if (result.score < threshold) continue;

      await supabaseAdmin.from('booker_matches').insert({
        artist_id: artistId,
        kind: 'gig',
        gig_id: gig.id,
        score: result.score,
        reasoning: result.reasoning,
        status: 'suggested',
      });
      matches++;
    } catch (err: any) {
      errors.push({ gig_id: gig.id, error: err?.message ?? 'match failed' });
    }
  }

  console.log(`[find-gigs] DONE: ${totalInserted} gigs, ${matches} matches, ${errors.length} errors`);

  return {
    artist_id: artistId,
    verticals,
    gigs_inserted: totalInserted,
    matches_created: matches,
    errors,
  };
}

// ─── Per-artist: find venues + match for one artist ─────────────

/** Venue search query templates per vertical — used to feed Google Places. */
const VENUE_QUERIES_BY_VERTICAL: Record<string, string[]> = {
  dj:            ['nightclubs', 'bars with DJ', 'lounges'],
  rapper:        ['hip hop venues', 'music venues', 'clubs'],
  singer:        ['live music venues', 'lounges', 'wedding venues'],
  band:          ['live music venues', 'music clubs', 'concert venues'],
  musician:      ['live music venues', 'restaurants with live music', 'lounges'],
  poet:          ['poetry venues', 'spoken word venues', 'libraries'],
  visual_artist: ['art galleries', 'creative spaces', 'museums'],
  other:         ['event venues', 'community spaces'],
  any:           ['live music venues', 'event venues'],
};

/**
 * Per-artist venue intake: Google Places search across the artist's verticals
 * (tailored to their city), researches each NEW venue, then runs the matcher
 * targeted just at this artist.
 */
export async function runVenuesForArtist(
  artistId: string,
  opts?: { maxVenuesPerQuery?: number }
): Promise<{
  artist_id: string;
  queries_run: string[];
  venues_inserted: number;
  venues_researched: number;
  matches_created: number;
  errors: any[];
}> {
  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', artistId)
    .is('deleted_at', null)
    .single();

  if (!artist) {
    return { artist_id: artistId, queries_run: [], venues_inserted: 0, venues_researched: 0, matches_created: 0, errors: ['Artist not found'] };
  }

  if (!artist.city) {
    return { artist_id: artistId, queries_run: [], venues_inserted: 0, venues_researched: 0, matches_created: 0, errors: ['Artist has no city — set city on their profile first'] };
  }

  const verticals: string[] = (artist.performer_types && artist.performer_types.length > 0)
    ? artist.performer_types
    : (artist.performer_type ? [artist.performer_type] : ['any']);

  const maxVenuesPerQuery = opts?.maxVenuesPerQuery ?? 10;
  const errors: any[] = [];
  const queriesRun: string[] = [];
  let totalInserted = 0;
  let totalResearched = 0;
  const newVenueIds: string[] = [];

  console.log(`[find-venues] START artist=${artistId} city=${artist.city} verticals=${verticals.join(',')}`);

  // Step 1: build queries from verticals + city, run Google Places, insert venues
  const seen = new Set<string>();
  for (const v of verticals) {
    const templates = VENUE_QUERIES_BY_VERTICAL[v] ?? VENUE_QUERIES_BY_VERTICAL.any;
    for (const t of templates) {
      const q = `${t} in ${artist.city}${artist.region ? ', ' + artist.region : ''}`;
      if (seen.has(q)) continue;
      seen.add(q);
      queriesRun.push(q);
      console.log(`[find-venues] query: ${q}`);

      try {
        const result = await runVenueBuild(q, maxVenuesPerQuery);
        console.log(`[find-venues]   → ${result.inserted} new venues (of ${result.found} found, ${result.skipped_duplicate} dup, ${result.skipped_no_website} no website)`);
        totalInserted += result.inserted;

        // Pull the IDs of venues just inserted from this query
        if (result.inserted > 0) {
          const { data: justInserted } = await supabaseAdmin
            .from('booker_venues')
            .select('id')
            .eq('source_url', `google_places: ${q}`)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(result.inserted);
          for (const row of justInserted ?? []) {
            newVenueIds.push(row.id);
          }
        }
      } catch (err: any) {
        errors.push({ query: q, error: err?.message ?? 'unknown' });
      }
    }
  }

  // Step 2: research each newly inserted venue (so matcher has context)
  console.log(`[find-venues] researching ${newVenueIds.length} new venues…`);
  let researchIdx = 0;
  for (const vid of newVenueIds) {
    researchIdx++;
    try {
      const r = await researchVenueAndSave(vid);
      if (r.ok) totalResearched++;
      if (researchIdx % 5 === 0) console.log(`[find-venues]   researched ${researchIdx}/${newVenueIds.length}`);
    } catch (err: any) {
      errors.push({ venue_id: vid, error: err?.message ?? 'research failed' });
    }
  }
  console.log(`[find-venues] research done: ${totalResearched}/${newVenueIds.length}`);

  // Step 3: run matcher just for this artist against researched venues
  const settings = await getAllBookerSettings();
  const threshold = parseInt(settings.match_threshold ?? '70', 10);

  const { data: existingMatches } = await supabaseAdmin
    .from('booker_matches')
    .select('venue_id')
    .eq('artist_id', artistId)
    .eq('kind', 'venue');
  const existingVenueIds = new Set((existingMatches ?? []).map((m: any) => m.venue_id));

  const { data: venues } = await supabaseAdmin
    .from('booker_venues')
    .select('*')
    .in('status', ['new', 'researched'])
    .is('deleted_at', null)
    .not('ai_research', 'is', null);

  console.log(`[find-venues] matching ${venues?.length ?? 0} researched venues for artist…`);
  let matches = 0;
  for (const venue of (venues ?? []) as BookerVenue[]) {
    if (existingVenueIds.has(venue.id)) continue;

    try {
      const result = await scoreVenueMatch(artist as BookerArtist, venue);
      if (result.score < threshold) continue;

      await supabaseAdmin.from('booker_matches').insert({
        artist_id: artistId,
        kind: 'venue',
        venue_id: venue.id,
        score: result.score,
        reasoning: result.reasoning,
        status: 'suggested',
      });
      matches++;
    } catch (err: any) {
      errors.push({ venue_id: venue.id, error: err?.message ?? 'match failed' });
    }
  }

  console.log(`[find-venues] DONE: ${queriesRun.length} queries, ${totalInserted} new venues, ${totalResearched} researched, ${matches} matches, ${errors.length} errors`);

  return {
    artist_id: artistId,
    queries_run: queriesRun,
    venues_inserted: totalInserted,
    venues_researched: totalResearched,
    matches_created: matches,
    errors,
  };
}

// ─── Build B: Venue intake via Google Places ──────────────────────

export async function runVenueBuild(query: string, maxResults = 20): Promise<{
  found: number;
  inserted: number;
  skipped_no_website: number;
  skipped_duplicate: number;
}> {
  const places = await searchVenues(query, maxResults);

  const withWebsites = places.filter((p) => p.website);
  const withoutWebsites = places.length - withWebsites.length;

  if (withWebsites.length === 0) {
    return { found: places.length, inserted: 0, skipped_no_website: withoutWebsites, skipped_duplicate: 0 };
  }

  // Dedup by website
  const websites = withWebsites.map((p) => p.website!).filter(Boolean);
  const { data: existingRows } = await supabaseAdmin
    .from('booker_venues')
    .select('website_url')
    .in('website_url', websites);
  const existing = new Set((existingRows ?? []).map((r: any) => r.website_url));

  const rows = withWebsites
    .filter((p) => !existing.has(p.website!))
    .map((p) => ({
      name: p.name,
      website_url: p.website,
      address: p.address,
      contact_phone: p.phone,
      city: extractCityFromAddress(p.address),
      region: extractRegionFromAddress(p.address),
      venue_type: p.venue_type_guess,
      source: 'google_places' as const,
      source_url: `google_places: ${query}`,
      status: 'new' as const,
      notes:
        [p.rating ? `Rating: ${p.rating} (${p.user_ratings_total} reviews)` : null]
          .filter(Boolean)
          .join('\n') || null,
    }));

  const skippedDup = withWebsites.length - rows.length;

  if (rows.length === 0) {
    return { found: places.length, inserted: 0, skipped_no_website: withoutWebsites, skipped_duplicate: skippedDup };
  }

  const { data: inserted } = await supabaseAdmin
    .from('booker_venues')
    .insert(rows)
    .select('id');

  return {
    found: places.length,
    inserted: inserted?.length ?? 0,
    skipped_no_website: withoutWebsites,
    skipped_duplicate: skippedDup,
  };
}

function extractCityFromAddress(addr: string | null): string | null {
  if (!addr) return null;
  // "1234 Main St, Chicago, IL 60601, USA" → "Chicago"
  const parts = addr.split(',').map((p) => p.trim());
  return parts[parts.length - 3] ?? null;
}

function extractRegionFromAddress(addr: string | null): string | null {
  if (!addr) return null;
  // "1234 Main St, Chicago, IL 60601, USA" → "IL"
  const parts = addr.split(',').map((p) => p.trim());
  const stateZip = parts[parts.length - 2];
  if (!stateZip) return null;
  return stateZip.split(/\s+/)[0] ?? null;
}

// ─── Researcher (wrap + persist) ──────────────────────────────────

export async function researchVenueAndSave(venueId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: venue } = await supabaseAdmin
    .from('booker_venues')
    .select('*')
    .eq('id', venueId)
    .single();

  if (!venue) return { ok: false, error: 'Venue not found' };
  if (!venue.website_url) return { ok: false, error: 'No website URL' };

  const { research, error } = await researchVenue(venue.name, venue.website_url);

  if (research) {
    // Promote AI-extracted contact info into the proper columns —
    // ONLY if the column is currently empty (don't overwrite manual entries).
    const update: Record<string, unknown> = {
      ai_research: research,
      status: venue.status === 'new' ? 'researched' : venue.status,
    };
    if (!venue.contact_email && research.booking_email) {
      update.contact_email = research.booking_email;
    }
    if (!venue.contact_phone && research.booking_phone) {
      update.contact_phone = research.booking_phone;
    }
    if (!venue.contact_name && research.booking_contact_name) {
      update.contact_name = research.booking_contact_name;
    }

    await supabaseAdmin
      .from('booker_venues')
      .update(update)
      .eq('id', venueId);
  }

  return { ok: !!research, error };
}

// ─── Matcher (across roster) ──────────────────────────────────────

/**
 * Score active artists against un-matched gigs + venues.
 * Only matches above match_threshold are inserted into booker_matches.
 */
export async function runMatch(): Promise<{
  artists_processed: number;
  gig_matches: number;
  venue_matches: number;
}> {
  const settings = await getAllBookerSettings();
  const threshold = parseInt(settings.match_threshold ?? '70', 10);

  const { data: artists } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('status', 'active')
    .is('deleted_at', null);

  if (!artists || artists.length === 0) {
    return { artists_processed: 0, gig_matches: 0, venue_matches: 0 };
  }

  // Find existing matches so we don't duplicate
  const { data: existingMatches } = await supabaseAdmin
    .from('booker_matches')
    .select('artist_id, gig_id, venue_id, kind');

  const existingGig = new Set<string>(
    (existingMatches ?? [])
      .filter((m: any) => m.kind === 'gig')
      .map((m: any) => `${m.artist_id}:${m.gig_id}`)
  );
  const existingVenue = new Set<string>(
    (existingMatches ?? [])
      .filter((m: any) => m.kind === 'venue')
      .map((m: any) => `${m.artist_id}:${m.venue_id}`)
  );

  // Get unmatched gigs (status='normalized', is_real_gig=true)
  const { data: gigs } = await supabaseAdmin
    .from('booker_gigs')
    .select('*')
    .eq('status', 'normalized')
    .is('deleted_at', null);

  // Get researched venues (status='researched' or 'new' with research)
  const { data: venues } = await supabaseAdmin
    .from('booker_venues')
    .select('*')
    .in('status', ['new', 'researched'])
    .is('deleted_at', null)
    .not('ai_research', 'is', null);

  let gigMatches = 0;
  let venueMatches = 0;

  for (const artist of artists as BookerArtist[]) {
    for (const gig of (gigs ?? []) as BookerGig[]) {
      if (existingGig.has(`${artist.id}:${gig.id}`)) continue;

      const result = await scoreGigMatch(artist, gig);
      if (result.score < threshold) continue;

      await supabaseAdmin.from('booker_matches').insert({
        artist_id: artist.id,
        kind: 'gig',
        gig_id: gig.id,
        score: result.score,
        reasoning: result.reasoning,
        status: 'suggested',
      });
      gigMatches++;
    }

    for (const venue of (venues ?? []) as BookerVenue[]) {
      if (existingVenue.has(`${artist.id}:${venue.id}`)) continue;

      const result = await scoreVenueMatch(artist, venue);
      if (result.score < threshold) continue;

      await supabaseAdmin.from('booker_matches').insert({
        artist_id: artist.id,
        kind: 'venue',
        venue_id: venue.id,
        score: result.score,
        reasoning: result.reasoning,
        status: 'suggested',
      });
      venueMatches++;
    }
  }

  return { artists_processed: artists.length, gig_matches: gigMatches, venue_matches: venueMatches };
}

// ─── Send gig suggestion to artist ────────────────────────────────

export async function sendMatchToArtist(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: match } = await supabaseAdmin
    .from('booker_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (!match) return { ok: false, error: 'Match not found' };
  if (match.kind !== 'gig') return { ok: false, error: 'Not a gig match' };

  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', match.artist_id)
    .single();
  if (!artist?.email) return { ok: false, error: 'Artist has no email' };

  const { data: gig } = await supabaseAdmin
    .from('booker_gigs')
    .select('*')
    .eq('id', match.gig_id)
    .single();
  if (!gig) return { ok: false, error: 'Gig not found' };

  // Draft if not already drafted
  let subject = match.draft_subject;
  let body = match.draft_body;
  if (!subject || !body) {
    const composed = await composeGigSuggestion(artist, gig, match.reasoning ?? '');
    subject = composed.subject;
    body = composed.body;
  }

  try {
    const result = await sendArtistEmail({
      to: artist.email,
      subject,
      eyebrow: '// New gig opportunity',
      title: subject,
      body,
    });

    await supabaseAdmin.from('booker_outreach').insert({
      match_id: match.id,
      artist_id: artist.id,
      direction: 'to_artist',
      to_email: artist.email,
      subject,
      body,
      resend_message_id: result.messageId,
      status: 'sent',
    });

    await supabaseAdmin
      .from('booker_matches')
      .update({
        draft_subject: subject,
        draft_body: body,
        status: 'sent_to_artist',
        sent_to_artist_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    await supabaseAdmin.from('booker_gigs').update({ status: 'sent' }).eq('id', gig.id);

    return { ok: true };
  } catch (err: any) {
    console.error(`[booker-engine] sendMatchToArtist error: ${err?.message}`);
    return { ok: false, error: err?.message ?? 'Send failed' };
  }
}

// ─── Pitch venue ──────────────────────────────────────────────────

export async function pitchVenueForMatch(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: match } = await supabaseAdmin
    .from('booker_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (!match) return { ok: false, error: 'Match not found' };
  if (match.kind !== 'venue') return { ok: false, error: 'Not a venue match' };

  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', match.artist_id)
    .single();
  if (!artist) return { ok: false, error: 'Artist not found' };

  const { data: venue } = await supabaseAdmin
    .from('booker_venues')
    .select('*')
    .eq('id', match.venue_id)
    .single();
  if (!venue?.contact_email) return { ok: false, error: 'Venue has no contact email' };

  // Suppression check
  const { data: suppressed } = await supabaseAdmin
    .from('suppression_list')
    .select('email')
    .eq('email', venue.contact_email.toLowerCase())
    .maybeSingle();
  if (suppressed) return { ok: false, error: 'Venue email is suppressed' };

  let subject = match.draft_subject;
  let body = match.draft_body;
  if (!subject || !body) {
    const composed = await composeVenuePitch(artist, venue);
    subject = composed.subject;
    body = composed.body;
  }

  try {
    const result = await sendVenuePitch({
      to: venue.contact_email,
      subject,
      body,
      headers: { 'X-Match-Id': matchId },
    });

    await supabaseAdmin.from('booker_outreach').insert({
      match_id: matchId,
      artist_id: artist.id,
      direction: 'to_venue',
      to_email: venue.contact_email,
      subject,
      body,
      resend_message_id: result.messageId,
      status: 'sent',
    });

    await supabaseAdmin
      .from('booker_matches')
      .update({
        draft_subject: subject,
        draft_body: body,
        status: 'pitched',
        pitched_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    await supabaseAdmin.from('booker_venues').update({ status: 'contacted' }).eq('id', venue.id);

    return { ok: true };
  } catch (err: any) {
    console.error(`[booker-engine] pitchVenue error: ${err?.message}`);
    return { ok: false, error: err?.message ?? 'Send failed' };
  }
}

// ─── Venue follow-ups (cron-driven) ───────────────────────────────

/**
 * Send a single follow-up to venues that were pitched 7+ days ago and haven't responded.
 * Respects venue_daily_cap.
 */
export async function runVenueFollowUps(): Promise<{ sent: number; errors: any[] }> {
  const settings = await getAllBookerSettings();
  const dailyCap = parseInt(settings.venue_daily_cap ?? '15', 10);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: sentToday } = await supabaseAdmin
    .from('booker_outreach')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'to_venue')
    .gte('created_at', today.toISOString());

  const remaining = dailyCap - (sentToday ?? 0);
  if (remaining <= 0) return { sent: 0, errors: [] };

  // Pitched 7+ days ago, still 'pitched' status (no reply)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: matches } = await supabaseAdmin
    .from('booker_matches')
    .select('*, venue:booker_venues(*), artist:booker_artists(*)')
    .eq('status', 'pitched')
    .eq('kind', 'venue')
    .lte('pitched_at', sevenDaysAgo.toISOString())
    .limit(remaining);

  let sent = 0;
  const errors: any[] = [];

  for (const match of matches ?? []) {
    const venue = (match as any).venue;
    const artist = (match as any).artist;
    if (!venue?.contact_email || !artist) continue;

    try {
      // Simple follow-up — short bump
      const followUpBody = `Bumping this in case it slipped past — still open to a quick chat about ${artist.stage_name ?? artist.name ?? 'our artist'} performing at ${venue.name}?\n\nIf the timing is off, no worries.`;
      const subject = `Re: ${match.draft_subject ?? 'follow up'}`;

      const result = await sendVenuePitch({
        to: venue.contact_email,
        subject,
        body: followUpBody,
        headers: { 'X-Match-Id': match.id, 'X-Followup': '1' },
      });

      await supabaseAdmin.from('booker_outreach').insert({
        match_id: match.id,
        artist_id: artist.id,
        direction: 'to_venue',
        to_email: venue.contact_email,
        subject,
        body: followUpBody,
        resend_message_id: result.messageId,
        status: 'sent',
      });

      sent++;
    } catch (err: any) {
      errors.push({ matchId: match.id, error: err?.message });
    }
  }

  return { sent, errors };
}

// ─── Inbound handlers (webhook callbacks) ─────────────────────────

export async function processInboundReply(
  senderEmail: string,
  subject: string,
  body: string
): Promise<{ matched: boolean; matchId?: string; action?: string }> {
  const email = senderEmail.toLowerCase().trim();
  const bodyLower = body.toLowerCase().trim();
  const isStop = /^stop$|^unsubscribe$|^remove me$|not interested/i.test(bodyLower.split('\n')[0]);

  // Match by venue contact_email first (most outbound replies are from venues)
  const { data: venue } = await supabaseAdmin
    .from('booker_venues')
    .select('id, status, notes')
    .ilike('contact_email', email)
    .in('status', ['contacted'])
    .maybeSingle();

  if (venue) {
    if (isStop) {
      await supabaseAdmin
        .from('suppression_list')
        .upsert({ email, reason: 'unsubscribed' }, { onConflict: 'email' });
      await supabaseAdmin
        .from('booker_venues')
        .update({
          status: 'suppressed',
          notes: (venue.notes ?? '') + `\n\n[Auto] Unsubscribed: ${body.slice(0, 100)}`,
        })
        .eq('id', venue.id);
      return { matched: true, action: 'suppressed_venue' };
    } else {
      await supabaseAdmin
        .from('booker_venues')
        .update({
          status: 'responsive',
          notes: (venue.notes ?? '') + `\n\n[Auto] Reply received:\n${body.slice(0, 500)}`,
        })
        .eq('id', venue.id);

      // Mark the latest match as 'interested'
      const { data: match } = await supabaseAdmin
        .from('booker_matches')
        .select('id')
        .eq('venue_id', venue.id)
        .eq('status', 'pitched')
        .order('pitched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (match) {
        await supabaseAdmin
          .from('booker_matches')
          .update({ status: 'interested' })
          .eq('id', match.id);
        return { matched: true, matchId: match.id, action: 'venue_interested' };
      }
      return { matched: true, action: 'venue_responded' };
    }
  }

  // Match by artist email (artist replying yes/no to a gig suggestion)
  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('id, notes')
    .ilike('email', email)
    .maybeSingle();

  if (artist) {
    const sayingYes = /^yes\b|interested|let'?s do it|go for it|pitch me/i.test(bodyLower.split('\n')[0]);
    const sayingNo = /^no\b|pass|skip|not for me/i.test(bodyLower.split('\n')[0]);

    // Find latest sent_to_artist match
    const { data: match } = await supabaseAdmin
      .from('booker_matches')
      .select('id')
      .eq('artist_id', artist.id)
      .eq('status', 'sent_to_artist')
      .order('sent_to_artist_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (match) {
      if (sayingYes) {
        await supabaseAdmin
          .from('booker_matches')
          .update({ status: 'artist_approved' })
          .eq('id', match.id);
        return { matched: true, matchId: match.id, action: 'artist_approved' };
      }
      if (sayingNo) {
        await supabaseAdmin
          .from('booker_matches')
          .update({ status: 'passed' })
          .eq('id', match.id);
        return { matched: true, matchId: match.id, action: 'artist_passed' };
      }
    }
  }

  return { matched: false };
}

export async function processBounce(email: string): Promise<void> {
  const addr = email.toLowerCase().trim();

  await supabaseAdmin
    .from('suppression_list')
    .upsert({ email: addr, reason: 'bounced' }, { onConflict: 'email' });

  await supabaseAdmin
    .from('booker_venues')
    .update({ status: 'dead' })
    .ilike('contact_email', addr)
    .in('status', ['contacted', 'new', 'researched']);

  await supabaseAdmin
    .from('booker_outreach')
    .update({ status: 'bounced' })
    .ilike('to_email', addr)
    .eq('status', 'sent');
}
