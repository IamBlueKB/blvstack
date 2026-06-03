/**
 * BLVBooker venue discovery via Yelp Fusion API.
 * Free tier: 5,000 calls/day. Auth via Bearer YELP_API_KEY.
 *
 * Mirrors the shape of PlaceVenueResult from places.ts so the engine can
 * treat both sources uniformly and dedupe by website_url.
 *
 * Docs: https://docs.developer.yelp.com/reference/v3_business_search
 */

import type { VenueType } from './types';

const YELP_SEARCH = 'https://api.yelp.com/v3/businesses/search';

export interface YelpVenueResult {
  name: string;
  website: string | null;   // Yelp doesn't return external website; we keep `null` and let researcher discover it via the Yelp URL fallback
  yelp_url: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  categories: string[];
  venue_type_guess: VenueType;
}

/**
 * Map Yelp `alias` strings (from category objects) → our VenueType enum.
 * Yelp aliases reference: https://docs.developer.yelp.com/docs/resources-categories
 */
function guessVenueType(aliases: string[]): VenueType {
  const t = aliases.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes('danceclubs') || x.includes('nightlife'))) return 'club';
  if (t.some((x) => x.includes('venues') || x.includes('weddingplanning') || x.includes('banquethalls'))) return 'private_events';
  if (t.some((x) => x.includes('musicvenues') || x.includes('concerthalls') || x.includes('theater'))) return 'theater';
  if (t.some((x) => x.includes('galleries') || x.includes('museums'))) return 'gallery';
  if (t.some((x) => x.includes('coffee') || x.includes('cafes'))) return 'coffeehouse';
  if (t.some((x) => x.includes('libraries'))) return 'library';
  if (t.some((x) => x.includes('hotels') || x.includes('resorts'))) return 'private_events';
  if (t.some((x) => x.includes('breweries') || x.includes('wineries') || x.includes('distilleries'))) return 'bar';
  if (t.some((x) => x.includes('bars') || x.includes('lounges') || x.includes('pubs'))) return 'bar';
  if (t.some((x) => x.includes('restaurants'))) return 'restaurant';
  return 'other';
}

interface YelpBusiness {
  id: string;
  name: string;
  url: string;
  phone: string | null;
  display_phone: string | null;
  rating: number | null;
  review_count: number | null;
  categories: { alias: string; title: string }[];
  location: {
    address1: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    display_address: string[];
  };
}

interface YelpSearchResponse {
  businesses: YelpBusiness[];
  total: number;
}

/**
 * Search Yelp Fusion for venues.
 * @param term  e.g. "nightclubs", "wedding venues", "lounges"
 * @param location  city + state, e.g. "Chicago, IL"
 * @param maxResults  Yelp returns up to 50/page; we'll paginate (offset) until cap or end.
 * @param radiusMeters  optional — Yelp caps at 40000m (~25mi). We clamp internally.
 */
export async function searchYelpVenues(
  term: string,
  location: string,
  maxResults = 50,
  radiusMeters?: number
): Promise<YelpVenueResult[]> {
  const apiKey = import.meta.env.YELP_API_KEY;
  if (!apiKey) throw new Error('YELP_API_KEY not set');

  const results: YelpVenueResult[] = [];
  const pageSize = Math.min(50, maxResults);
  let offset = 0;
  const clampedRadius = radiusMeters ? Math.min(Math.max(radiusMeters, 1000), 40000) : null;

  while (results.length < maxResults) {
    const url =
      `${YELP_SEARCH}?term=${encodeURIComponent(term)}` +
      `&location=${encodeURIComponent(location)}` +
      `&limit=${pageSize}` +
      `&offset=${offset}` +
      `&sort_by=best_match` +
      (clampedRadius ? `&radius=${clampedRadius}` : '');

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[booker-yelp] error: ${res.status} ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as YelpSearchResponse;
    const batch = json.businesses ?? [];

    for (const b of batch) {
      if (results.length >= maxResults) break;
      const aliases = (b.categories ?? []).map((c) => c.alias);
      const addressParts = b.location?.display_address ?? [];
      results.push({
        name: b.name,
        website: null, // Yelp doesn't expose external website; researcher discovers via name+address
        yelp_url: b.url ?? null,
        address: addressParts.length ? addressParts.join(', ') : null,
        phone: b.display_phone ?? b.phone ?? null,
        rating: b.rating ?? null,
        user_ratings_total: b.review_count ?? null,
        categories: aliases,
        venue_type_guess: guessVenueType(aliases),
      });
    }

    if (batch.length < pageSize) break; // end of results
    offset += pageSize;
    // Yelp caps offset at 1000; bail if we're close
    if (offset >= 1000) break;
  }

  return results;
}
