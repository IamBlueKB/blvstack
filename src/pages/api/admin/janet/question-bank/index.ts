import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DEAL_TYPES = ['refresh', 'new_build', 'rescue'];

/** GET /api/admin/janet/question-bank — the full editable bank (standard + templates). */
export const GET: APIRoute = async () => {
  const { data, error } = await supabaseAdmin
    .from('janet_question_bank')
    .select('*')
    .order('sort', { ascending: true });
  if (error) return j({ error: error.message }, 500);
  return j({ questions: data ?? [] });
};

/** POST /api/admin/janet/question-bank — add a question (standard if deal_type null). */
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const text = typeof b?.text === 'string' ? b.text.trim() : '';
  if (!text) return j({ error: 'text required' }, 400);
  const dealType = DEAL_TYPES.includes(b?.deal_type) ? b.deal_type : null;
  const sort = typeof b?.sort === 'number' ? b.sort : 999;
  const topic = typeof b?.topic === 'string' && b.topic.trim() ? b.topic.trim().toLowerCase() : null;
  const { data, error } = await supabaseAdmin
    .from('janet_question_bank')
    .insert({ text, deal_type: dealType, sort, topic })
    .select()
    .single();
  if (error) return j({ error: error.message }, 500);
  return j({ question: data });
};
