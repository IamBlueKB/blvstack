import type { APIRoute } from 'astro';
import { searchThreadsAndDocs } from '../../../lib/janet/docs';

export const prerender = false;

/**
 * GET /api/janet/search?q=<phrase>&client_id=<id>
 * Full-text-ish search across all threads and docs (spec Feature 2). Returns
 * snippets with their source so Blue can jump to a thread or doc.
 * Auth: founder blvstack_admin session (middleware).
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) return json({ docs: [], threads: [] });
  const res = await searchThreadsAndDocs(q, { clientId: url.searchParams.get('client_id') });
  return json(res);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
