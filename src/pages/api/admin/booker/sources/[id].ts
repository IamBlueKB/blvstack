import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

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
  const allowed = ['vertical', 'source_type', 'label', 'url', 'city', 'region', 'active', 'notes'];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) return j({ error: 'No valid fields' }, 400);
  const { error } = await supabaseAdmin.from('booker_sources').update(update).eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { error } = await supabaseAdmin.from('booker_sources').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
