import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../../lib/booker/access';

export const prerender = false;

/**
 * POST { booked_amount: number }
 * Marks a match as booked + auto-creates a success_fee payment record.
 * Manager+ only — agents cannot touch money.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: { booked_amount?: number };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const bookedAmount = body.booked_amount;
  if (!bookedAmount || bookedAmount <= 0) return j({ error: 'booked_amount required' }, 400);

  const { data: match } = await supabaseAdmin
    .from('booker_matches')
    .select('*, artist:booker_artists(id, success_fee_pct)')
    .eq('id', id)
    .single();

  if (!match) return j({ error: 'Match not found' }, 404);

  await supabaseAdmin
    .from('booker_matches')
    .update({
      status: 'booked',
      booked_at: new Date().toISOString(),
      booked_amount: bookedAmount,
    })
    .eq('id', id);

  if (match.kind === 'venue' && match.venue_id) {
    await supabaseAdmin.from('booker_venues').update({ status: 'booked' }).eq('id', match.venue_id);
  }

  const artist = (match as any).artist;
  if (artist?.success_fee_pct) {
    const fee = Math.round(bookedAmount * (artist.success_fee_pct / 100));
    await supabaseAdmin.from('booker_payments').insert({
      artist_id: match.artist_id,
      match_id: id,
      type: 'success_fee',
      amount: fee,
      status: 'pending',
      method: 'manual',
      notes: `${artist.success_fee_pct}% of $${bookedAmount} booking`,
    });
  }

  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
