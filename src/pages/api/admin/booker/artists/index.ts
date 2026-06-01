import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole, assignedArtistIds, stripMoney } from '../../../../../lib/booker/access';
import { randomBytes } from 'crypto';

export const prerender = false;

/** GET — list artists (scoped for agents). */
export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireActor(locals);
  const status = url.searchParams.get('status');

  let query = supabaseAdmin
    .from('booker_artists')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (status && status !== 'all') query = query.eq('status', status);

  if (actor.role === 'agent') {
    const ids = await assignedArtistIds(actor);
    if (!ids || ids.length === 0) return j({ artists: [] });
    query = query.in('id', ids);
  }

  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ artists: stripMoney(actor, data ?? []) });
};

/** POST — create artist (manager+ only). */
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const intakeToken = randomBytes(24).toString('base64url');

  const row = {
    intake_token: intakeToken,
    name: body.name ?? null,
    stage_name: body.stage_name ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    performer_type: body.performer_type ?? null,
    city: body.city ?? null,
    region: body.region ?? null,
    status: body.status ?? 'prospect',
    monthly_rate: body.monthly_rate ?? null,
    success_fee_pct: body.success_fee_pct ?? null,
    notes: body.notes ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('booker_artists')
    .insert(row)
    .select()
    .single();

  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, artist: data });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
