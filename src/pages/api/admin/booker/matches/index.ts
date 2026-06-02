import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { runMatch } from '../../../../../lib/booker/engine';
import { requireActor, assignedArtistIds, stripMoney } from '../../../../../lib/booker/access';

export const prerender = false;
export const maxDuration = 300;

export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireActor(locals);
  const status = url.searchParams.get('status');
  const artistId = url.searchParams.get('artist_id');
  const kind = url.searchParams.get('kind');

  let query = supabaseAdmin
    .from('booker_matches')
    .select('*, artist:booker_artists(id, name, stage_name, email), gig:booker_gigs(id, title, venue_name, gig_date, pay_amount, vertical), venue:booker_venues(id, name, city, venue_type)')
    .order('score', { ascending: false })
    .order('created_at', { ascending: false });
  if (status && status !== 'all') query = query.eq('status', status);
  if (artistId) query = query.eq('artist_id', artistId);
  if (kind) query = query.eq('kind', kind);

  if (actor.role === 'agent') {
    const ids = await assignedArtistIds(actor);
    if (!ids || ids.length === 0) return j({ matches: [] });
    query = query.in('artist_id', ids);
  }

  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ matches: stripMoney(actor, data ?? []) });
};

export const POST: APIRoute = async ({ locals }) => {
  // Match run is allowed for all roles — matcher only surfaces matches; access still scoped on read.
  requireActor(locals);
  try {
    const result = await runMatch();
    return j({ ok: true, ...result });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Match run failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
