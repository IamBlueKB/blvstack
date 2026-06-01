import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireArtistAccess, stripMoney, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

async function ownerOfMatch(matchId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('booker_matches')
    .select('artist_id')
    .eq('id', matchId)
    .maybeSingle();
  return data?.artist_id ?? null;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const ownerArtist = await ownerOfMatch(id);
  if (!ownerArtist) return j({ error: 'Match not found' }, 404);
  const denied = await requireArtistAccess(actor, ownerArtist);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from('booker_matches')
    .select('*, artist:booker_artists(*), gig:booker_gigs(*), venue:booker_venues(*)')
    .eq('id', id)
    .single();
  if (error || !data) return j({ error: 'Match not found' }, 404);
  return j({ match: stripMoney(actor, data) });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const ownerArtist = await ownerOfMatch(id);
  if (!ownerArtist) return j({ error: 'Match not found' }, 404);
  const denied = await requireArtistAccess(actor, ownerArtist);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const baseAllowed = ['draft_subject', 'draft_body', 'status', 'notes'];
  // Only manager+ may set booked_amount (agents are not allowed to touch money)
  const allowed = actor.role === 'agent' ? baseAllowed : [...baseAllowed, 'booked_amount'];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) return j({ error: 'No valid fields' }, 400);
  const { error } = await supabaseAdmin.from('booker_matches').update(update).eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { error } = await supabaseAdmin.from('booker_matches').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
