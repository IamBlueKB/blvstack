import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireArtistAccess, requireRole, stripMoney } from '../../../../../lib/booker/access';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const denied = await requireArtistAccess(actor, id);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return j({ error: 'Artist not found' }, 404);
  return j({ artist: stripMoney(actor, data) });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const denied = await requireArtistAccess(actor, id);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  // Allowed fields by role
  const baseAllowed = [
    'name', 'stage_name', 'email', 'phone', 'performer_type', 'performer_types', 'genres',
    'city', 'region', 'travel_radius_mi', 'rate_floor', 'rate_notes',
    'gig_types', 'availability_notes', 'bio', 'press_kit_url', 'demo_url',
    'social_links', 'hard_nos', 'status', 'notes',
  ];
  // Only manager+ may edit billing
  const billingFields = ['monthly_rate', 'success_fee_pct'];
  const allowed = actor.role === 'agent' ? baseAllowed : [...baseAllowed, ...billingFields];

  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];

  // Multi-type sync: if performer_types is provided as array, keep performer_type
  // populated with the FIRST element so legacy code and lists still work.
  if (Array.isArray(update.performer_types)) {
    update.performer_types = (update.performer_types as unknown[]).filter(Boolean);
    if ((update.performer_types as unknown[]).length > 0) {
      update.performer_type = (update.performer_types as string[])[0];
    }
  }

  if (Object.keys(update).length === 0) return j({ error: 'No valid fields' }, 400);
  const { error } = await supabaseAdmin.from('booker_artists').update(update).eq('id', id);
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
    .from('booker_artists')
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
