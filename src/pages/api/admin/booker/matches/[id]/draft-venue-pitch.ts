import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { composeVenuePitch } from '../../../../../../lib/booker/composer';
import { requireActor, requireArtistAccess } from '../../../../../../lib/booker/access';
import type { BookerArtist, BookerVenue } from '../../../../../../lib/booker/types';

export const prerender = false;

/**
 * POST /api/admin/booker/matches/[id]/draft-venue-pitch
 * Composes the venue pitch email via AI and saves it as the match draft.
 * DOES NOT SEND. Lets the operator review/edit before clicking Send.
 * Works even if the venue has no contact_email yet.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data: match } = await supabaseAdmin
    .from('booker_matches')
    .select('*, artist:booker_artists(*), venue:booker_venues(*)')
    .eq('id', id)
    .single();
  if (!match) return j({ error: 'Match not found' }, 404);
  if (match.kind !== 'venue') return j({ error: 'Not a venue match' }, 400);

  const denied = await requireArtistAccess(actor, match.artist_id);
  if (denied) return denied;

  const artist = (match as any).artist as BookerArtist | null;
  const venue = (match as any).venue as BookerVenue | null;
  if (!artist) return j({ error: 'Artist not found' }, 404);
  if (!venue) return j({ error: 'Venue not found' }, 404);

  try {
    const { subject, body } = await composeVenuePitch(artist, venue);

    await supabaseAdmin
      .from('booker_matches')
      .update({
        draft_subject: subject,
        draft_body: body,
        status: match.status === 'suggested' ? 'drafted' : match.status,
      })
      .eq('id', id);

    return j({ ok: true, subject, body });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Draft failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
