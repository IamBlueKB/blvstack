import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { sendMatchToArtist } from '../../../../../../lib/booker/engine';
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
    const result = await sendMatchToArtist(id);
    return j(result);
  } catch (err: any) {
    return j({ error: err?.message ?? 'Send failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
