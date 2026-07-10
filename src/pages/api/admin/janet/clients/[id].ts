import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { normalizeClient, j } from './index';

export const prerender = false;

/** PUT /api/admin/janet/clients/:id — edit an account. */
export const PUT: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!b?.name?.trim()) return j({ error: 'name required' }, 400);
  const { data, error } = await supabaseAdmin
    .from('janet_clients')
    .update({ ...normalizeClient(b), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return j({ error: error.message }, 500);
  return j({ client: data });
};

/** DELETE /api/admin/janet/clients/:id — remove the account. Sites/deals keep
 *  their rows; their client_id is nulled by the FK (ON DELETE SET NULL). */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  const { error } = await supabaseAdmin.from('janet_clients').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};
