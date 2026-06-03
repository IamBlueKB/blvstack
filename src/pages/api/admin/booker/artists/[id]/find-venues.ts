import type { APIRoute } from 'astro';
import { runVenuesForArtist } from '../../../../../../lib/booker/engine';
import { requireActor, requireArtistAccess, requireRole } from '../../../../../../lib/booker/access';

export const prerender = false;
// Extend Vercel function timeout to its max (60s Pro, 800s Pro+ Fluid).
// Without this, long Places + research runs get killed silently.
export const maxDuration = 300;

/**
 * POST /api/admin/booker/artists/[id]/find-venues
 * Body: { maxVenuesPerQuery?: number }   default 10
 *
 * NOTE: `maxVenuesPerQuery` is now a TOTAL TARGET, not per-query. Field name
 * kept for API back-compat. UI sends as "venues to find" — engine bails when
 * the total of newly inserted venues hits this number.
 *
 * Per-artist venue intake. Hits Google Places + Yelp + researches + matches
 * just for this artist. Manager+ only (uses paid Places API quota).
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const aDenied = await requireArtistAccess(actor, id);
  if (aDenied) return aDenied;

  let body: { maxVenuesPerQuery?: number } = {};
  try {
    body = await request.json();
  } catch {
    // empty body ok
  }

  // Clamp to 40 — matches UI max. Beyond that, function timeout risk spikes.
  const maxVenuesPerQuery = Math.min(
    Math.max(parseInt(String(body.maxVenuesPerQuery ?? 10), 10) || 10, 1),
    40
  );

  try {
    const result = await runVenuesForArtist(id, { maxVenuesPerQuery });
    return j({ ok: true, ...result });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Find venues failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
