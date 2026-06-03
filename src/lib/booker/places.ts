/**
 * BLVBooker venue discovery via Google Places API (New).
 * Mirrors the pattern in src/lib/outbound/places.ts but tuned for venue intake:
 * also returns a venue_type guess and includes address/phone.
 *
 * Reuses GOOGLE_PLACES_API_KEY env var.
 */

import type { VenueType } from './types';

const PLACES_API = 'https://places.googleapis.com/v1/places:searchText';

export interface PlaceVenueResult {
  name: string;
  website: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  types: string[];
  venue_type_guess: VenueType;
}

/** Map Google place types → our VenueType enum. */
function guessVenueType(types: string[]): VenueType {
  const t = types.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes('night_club'))) return 'club';
  if (t.some((x) => x.includes('wedding_venue') || x.includes('banquet_hall'))) return 'private_events';
  if (t.some((x) => x.includes('event_venue'))) return 'private_events';
  if (t.some((x) => x.includes('concert_hall') || x.includes('performing_arts_theater'))) return 'theater';
  if (t.some((x) => x.includes('art_gallery') || x.includes('museum'))) return 'gallery';
  if (t.some((x) => x.includes('cafe') || x.includes('coffee_shop'))) return 'coffeehouse';
  if (t.some((x) => x.includes('library'))) return 'library';
  if (t.some((x) => x.includes('university') || x.includes('school'))) return 'college';
  if (t.some((x) => x.includes('hotel') || x.includes('lodging'))) return 'private_events';
  if (t.some((x) => x.includes('brewery') || x.includes('winery'))) return 'bar';
  if (t.some((x) => x.includes('bar'))) return 'bar';
  if (t.some((x) => x.includes('restaurant'))) return 'restaurant';
  return 'other';
}

/**
 * Search Google Places for venues.
 * Example queries: "live music venues nashville", "wedding venues austin", "spoken word venues philadelphia"
 */
export async function searchVenues(query: string, maxResults = 20): Promise<PlaceVenueResult[]> {
  const apiKey = import.meta.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const results: PlaceVenueResult[] = [];
  let pageToken: string | null = null;
  const pagesNeeded = Math.ceil(Math.min(maxResults, 60) / 20);

  for (let page = 0; page < pagesNeeded; page++) {
    const body: Record<string, unknown> = {
      textQuery: query,
      pageSize: 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(PLACES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.types,nextPageToken',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[booker-places] error: ${res.status} ${errText.slice(0, 200)}`);
    }

    const json = await res.json();

    for (const place of json.places ?? []) {
      if (results.length >= maxResults) break;
      const types: string[] = place.types ?? [];
      results.push({
        name: place.displayName?.text ?? 'Unknown',
        website: place.websiteUri ?? null,
        address: place.formattedAddress ?? null,
        phone: place.nationalPhoneNumber ?? null,
        rating: place.rating ?? null,
        user_ratings_total: place.userRatingCount ?? null,
        types,
        venue_type_guess: guessVenueType(types),
      });
    }

    pageToken = json.nextPageToken ?? null;
    if (!pageToken || results.length >= maxResults) break;
  }

  return results;
}
