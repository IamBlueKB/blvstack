/**
 * Google Places API (New) client.
 * Used to find local business prospects.
 */

const PLACES_API = 'https://places.googleapis.com/v1/places:searchText';

export interface PlaceResult {
  name: string;
  website: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
}

/**
 * Search Google Places for businesses matching the query.
 * Example queries: "medspas in chicago", "marketing agencies in nyc"
 *
 * @param query — natural language search
 * @param maxResults — cap (1-60, but Google returns 20 per page, 3 pages max)
 */
export async function searchPlaces(query: string, maxResults = 20): Promise<PlaceResult[]> {
  const apiKey = import.meta.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const results: PlaceResult[] = [];
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
          'places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Places API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = await res.json();

    for (const place of json.places ?? []) {
      if (results.length >= maxResults) break;
      results.push({
        name: place.displayName?.text ?? 'Unknown',
        website: place.websiteUri ?? null,
        address: place.formattedAddress ?? null,
        phone: place.nationalPhoneNumber ?? null,
        rating: place.rating ?? null,
        user_ratings_total: place.userRatingCount ?? null,
      });
    }

    pageToken = json.nextPageToken ?? null;
    if (!pageToken || results.length >= maxResults) break;
  }

  return results;
}
