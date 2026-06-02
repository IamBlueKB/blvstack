import type { APIRoute } from 'astro';
import { runScrapeForArtist } from '../../../../../../lib/booker/engine';
import { requireActor, requireArtistAccess } from '../../../../../../lib/booker/access';

export const prerender = false;

/**
 * POST /api/admin/booker/artists/[id]/find-gigs
 * Body: { maxGigsPerVertical?: number }   default 10
 *
 * Scrapes gigs for this artist's verticals, then runs the matcher targeting
 * only this artist. Returns counts.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const denied = await requireArtistAccess(actor, id);
  if (denied) return denied;

  let body: { maxGigsPerVertical?: number } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }

  const maxGigsPerVertical = Math.min(
    Math.max(parseInt(String(body.maxGigsPerVertical ?? 10), 10) || 10, 1),
    100
  );

  try {
    const result = await runScrapeForArtist(id, { maxGigsPerVertical });
    return j({ ok: true, ...result });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Find gigs failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
