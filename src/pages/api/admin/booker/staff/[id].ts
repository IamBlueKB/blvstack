import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data, error } = await supabaseAdmin
    .from('booker_staff')
    .select('id, email, name, role, active, created_at, last_login_at, deleted_at, permissions')
    .eq('id', id)
    .single();
  if (error || !data) return j({ error: 'Staff not found' }, 404);

  const { data: assignments = [] } = await supabaseAdmin
    .from('booker_staff_assignments')
    .select('artist_id, artist:booker_artists(id, name, stage_name, status)')
    .eq('staff_id', id);

  return j({ staff: data, assignments });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const allowed = ['name', 'role', 'active', 'permissions'];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) return j({ error: 'No valid fields' }, 400);

  if (update.role && !['owner', 'manager', 'agent'].includes(update.role as string)) {
    return j({ error: 'invalid role' }, 400);
  }

  const { error } = await supabaseAdmin.from('booker_staff').update(update).eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

/** Soft-delete (deactivate; sets deleted_at). */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { error } = await supabaseAdmin
    .from('booker_staff')
    .update({ deleted_at: new Date().toISOString(), active: false })
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
