import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../../lib/booker/access';

export const prerender = false;

/**
 * POST { artist_ids: string[] }
 * Replaces the staff's assignment set with the provided artist IDs (idempotent).
 * Owner-only.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const { id: staffId } = params;
  if (!staffId) return j({ error: 'Missing id' }, 400);

  let body: { artist_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const ids = Array.isArray(body.artist_ids) ? body.artist_ids : [];

  // Delete current assignments, then bulk insert
  await supabaseAdmin.from('booker_staff_assignments').delete().eq('staff_id', staffId);

  if (ids.length > 0) {
    const rows = ids.map((artist_id) => ({ staff_id: staffId, artist_id }));
    const { error } = await supabaseAdmin.from('booker_staff_assignments').insert(rows);
    if (error) return j({ error: error.message }, 500);
  }

  return j({ ok: true, assigned_count: ids.length });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
