import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** GET /api/admin/janet/notepad/:id — full session, to resume from the list. */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  const { data, error } = await supabaseAdmin.from('janet_notepad_sessions').select('*').eq('id', id).maybeSingle();
  if (error) return j({ error: error.message }, 500);
  if (!data) return j({ error: 'not found' }, 404);
  return j({ session: data });
};

/** PUT /api/admin/janet/notepad/:id — autosave notes / edit title / attach to a
 *  deal / set deal-type. Only whitelisted fields; never touches prepped_questions
 *  or status here. */
export const PUT: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.notes === 'string') patch.notes = b.notes;
  if (typeof b.title === 'string') patch.title = b.title.trim() || null;
  if (typeof b.context === 'string') patch.context = b.context.trim() || null;
  if (Array.isArray(b.coverage)) patch.coverage = b.coverage;
  if (Array.isArray(b.blocks)) patch.blocks = b.blocks;
  if (b.deal_id === null || typeof b.deal_id === 'string') patch.deal_id = b.deal_id || null;
  if (['refresh', 'new_build', 'rescue'].includes(b.deal_type) || b.deal_type === null)
    patch.deal_type = b.deal_type ?? null;

  const { data, error } = await supabaseAdmin
    .from('janet_notepad_sessions')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return j({ error: error.message }, 500);
  return j({ session: data });
};

/** DELETE /api/admin/janet/notepad/:id — discard a session (notes on the deal, if
 *  already processed, are unaffected — they live on the deal record). */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  const { error } = await supabaseAdmin.from('janet_notepad_sessions').delete().eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};
