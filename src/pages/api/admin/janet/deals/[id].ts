import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { normalizeDeal, j } from '../deals';

export const prerender = false;

/** PUT — update a deal (same row the chat path edits). */
export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!b?.name?.trim()) return j({ error: 'name required' }, 400);
  const patch = { ...normalizeDeal(b), updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('janet_deals').update(patch).eq('id', id).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ deal: data });
};

/** DELETE — remove a deal. */
export const DELETE: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { error } = await supabaseAdmin.from('janet_deals').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};
