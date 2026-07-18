import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { pitchVenueForMatch } from '../../../../../../lib/booker/engine';
import { requireActor, requireArtistAccess } from '../../../../../../lib/booker/access';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data: m } = await supabaseAdmin
    .from('booker_matches')
    .select('artist_id')
    .eq('id', id)
    .maybeSingle();
  if (!m) return j({ error: 'Match not found' }, 404);
  const denied = await requireArtistAccess(actor, m.artist_id);
  if (denied) return denied;

  try {
    // The human click IS the approval → mint a manual ref for the gated executor.
    const result = await pitchVenueForMatch(id, `manual:${actor.email}:${id}`);
    return j(result);
  } catch (err: any) {
    return j({ error: err?.message ?? 'Pitch failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
