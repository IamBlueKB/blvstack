import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;

/** PUT — edit a memory (content/category) or toggle active. */
export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.content === 'string' && b.content.trim()) patch.content = b.content.trim();
  if (typeof b.category === 'string' && b.category.trim()) patch.category = b.category.trim();
  if (typeof b.active === 'boolean') patch.active = b.active;
  const { data, error } = await supabaseAdmin.from('janet_memory').update(patch).eq('id', id).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ memory: data });
};

/** DELETE — remove a memory. */
export const DELETE: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { error } = await supabaseAdmin.from('janet_memory').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
