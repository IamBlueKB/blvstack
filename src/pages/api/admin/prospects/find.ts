import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { searchPlaces } from '../../../../lib/outbound/places';

export const prerender = false;

/**
 * POST /api/admin/prospects/find
 * Body: { query: string, maxResults?: number }
 *
 * Searches Google Places for local businesses, inserts them as prospects.
 * Deduplicates by website URL.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { query?: string; maxResults?: number };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const query = body.query?.trim();
  if (!query) return j({ error: 'Provide a search query' }, 400);

  const maxResults = Math.min(Math.max(body.maxResults ?? 20, 1), 60);

  let places;
  try {
    places = await searchPlaces(query, maxResults);
  } catch (err: any) {
    return j({ error: err?.message ?? 'Places search failed' }, 500);
  }

  if (places.length === 0) {
    return j({ ok: true, found: 0, message: 'No results from Google Places' });
  }

  // Filter to ones with websites (no website = can't research/email)
  const withWebsites = places.filter((p) => p.website);
  const withoutWebsites = places.length - withWebsites.length;

  if (withWebsites.length === 0) {
    return j({
      ok: true,
      found: 0,
      message: `Found ${places.length} businesses but none have websites listed`,
    });
  }

  // Dedup by company_url against existing prospects
  const websites = withWebsites.map((p) => p.website).filter(Boolean) as string[];
  const { data: existingRows } = await supabaseAdmin
    .from('prospects')
    .select('company_url')
    .in('company_url', websites);
  const existing = new Set((existingRows ?? []).map((r: any) => r.company_url));

  const rows = withWebsites
    .filter((p) => !existing.has(p.website!))
    .map((p) => ({
      source_url: `google_places: ${query}`,
      company_name: p.name,
      company_url: p.website,
      notes:
        [
          p.address ? `Address: ${p.address}` : null,
          p.phone ? `Phone: ${p.phone}` : null,
          p.rating ? `Rating: ${p.rating} (${p.user_ratings_total} reviews)` : null,
        ]
          .filter(Boolean)
          .join('\n') || null,
      status: 'new',
    }));

  const skippedDup = withWebsites.length - rows.length;

  if (rows.length === 0) {
    return j({
      ok: true,
      found: 0,
      total: places.length,
      message: `All ${withWebsites.length} businesses already in your prospects list`,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('prospects')
    .insert(rows)
    .select();

  if (error) return j({ error: error.message }, 500);

  return j({
    ok: true,
    found: data?.length ?? 0,
    total: places.length,
    skipped_no_website: withoutWebsites,
    skipped_duplicate: skippedDup,
    message: `Added ${data?.length ?? 0} new prospects (${withoutWebsites} had no website, ${skippedDup} were duplicates)`,
  });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
