import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { HISTORY_LIMIT } from '../../../lib/janet/config';

export const prerender = false;

/**
 * GET /api/janet/history
 * Returns the most-recent messages (chronological) for the panel to render on
 * open. One continuous thread (spec §4.1) — same history on every admin page.
 * Auth: founder blvstack_admin session, enforced by middleware. Belt-and-
 * suspenders check below.
 *
 * Tool rows are collapsed out; only user/assistant text is returned. Live tool
 * activity is a stream-only concern (spec §4.5) and isn't replayed from history.
 */
export const GET: APIRoute = async ({ locals, url, request }) => {
  if (!locals.adminEmail) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Feature 1 — threads. Load the requested thread; if none given, the most
  // recent active thread. Falls back to the legacy archived_at filter only if
  // no threads exist yet.
  const params = url?.searchParams ?? new URL(request.url).searchParams;
  let threadId = params.get('thread_id');
  if (!threadId) {
    const { data: recent } = await supabaseAdmin
      .from('janet_threads')
      .select('id')
      .eq('status', 'active')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    threadId = recent?.id ?? null;
  }

  let query = supabaseAdmin
    .from('janet_messages')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  query = threadId ? query.eq('thread_id', threadId) : query.is('archived_at', null);

  const { data, error } = await query;

  if (error) {
    return json({ error: 'Could not load history', detail: error.message }, 500);
  }

  const messages = (data ?? [])
    .reverse() // oldest first
    .filter((row) => row.role !== 'tool')
    .map((row) => ({ role: row.role as 'user' | 'assistant', text: textOf(row.content) }))
    .filter((m) => m.text.length > 0);

  return json({ messages, thread_id: threadId });
};

/** Extract plain text from stored content blocks (string or block array). */
function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
