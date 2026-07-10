import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { normalizeSite, j } from '../sites';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!b?.name?.trim() || !b?.production_url?.trim()) return j({ error: 'name and production_url required' }, 400);
  const { data, error } = await supabaseAdmin.from('janet_sites').update(normalizeSite(b)).eq('id', id).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ site: data });
};

export const DELETE: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { error } = await supabaseAdmin.from('janet_sites').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};
