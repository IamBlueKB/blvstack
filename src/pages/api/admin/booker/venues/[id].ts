import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { data, error } = await supabaseAdmin
    .from('booker_venues')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return j({ error: 'Venue not found' }, 404);
  return j({ venue: data });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const allowed = ['name', 'venue_type', 'city', 'region', 'address', 'website_url', 'booking_url', 'contact_name', 'contact_email', 'contact_phone', 'verticals', 'genres_pref', 'capacity', 'status', 'notes'];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) return j({ error: 'No valid fields' }, 400);
  const { error } = await supabaseAdmin.from('booker_venues').update(update).eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { error } = await supabaseAdmin
    .from('booker_venues')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
