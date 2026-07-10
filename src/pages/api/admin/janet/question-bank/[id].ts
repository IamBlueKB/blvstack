import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** PUT /api/admin/janet/question-bank/:id — edit text, toggle active, reorder. */
export const PUT: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const patch: Record<string, unknown> = {};
  if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim();
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (typeof b.sort === 'number') patch.sort = b.sort;
  if (typeof b.topic === 'string') patch.topic = b.topic.trim().toLowerCase() || null;
  if (Object.keys(patch).length === 0) return j({ error: 'nothing to update' }, 400);
  const { data, error } = await supabaseAdmin
    .from('janet_question_bank')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return j({ error: error.message }, 500);
  return j({ question: data });
};

/** DELETE /api/admin/janet/question-bank/:id */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  const { error } = await supabaseAdmin.from('janet_question_bank').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};
