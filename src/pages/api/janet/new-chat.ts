import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

/**
 * POST /api/janet/new-chat — archive the current thread and start clean (spec 1.6).
 * Sets archived_at on every active janet_messages row. Nothing is deleted (the
 * archived thread is recoverable) and janet_memory is untouched — she forgets
 * the conversation, not what she has learned. Auth: founder session (middleware).
 */
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const { error, count } = await supabaseAdmin
    .from('janet_messages')
    .update({ archived_at: new Date().toISOString() }, { count: 'exact' })
    .is('archived_at', null);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, archived: count ?? 0 });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
