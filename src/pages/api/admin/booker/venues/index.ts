import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  requireActor(locals);
  const status = url.searchParams.get('status');
  const city = url.searchParams.get('city');
  let query = supabaseAdmin
    .from('booker_venues')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (status && status !== 'all') query = query.eq('status', status);
  if (city) query = query.ilike('city', `%${city}%`);
  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ venues: data ?? [] });
};

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
  const allowed = ['name', 'venue_type', 'city', 'region', 'address', 'website_url', 'booking_url', 'contact_name', 'contact_email', 'contact_phone', 'verticals', 'genres_pref', 'capacity', 'notes'];
  const row: Record<string, unknown> = { source: 'manual', status: 'new' };
  for (const k of allowed) if (k in body) row[k] = body[k];
  if (!row.name) return j({ error: 'name required' }, 400);
  const { data, error } = await supabaseAdmin.from('booker_venues').insert(row).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, venue: data });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
