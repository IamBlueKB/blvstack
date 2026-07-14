import type { APIRoute } from 'astro';
import { listThreads, createThread, archiveThread } from '../../../lib/janet/threads';

export const prerender = false;

/**
 * GET  /api/janet/threads              → list active threads (with client_name)
 * POST /api/janet/threads              → create { title, client_id? }
 * POST /api/janet/threads?archive=<id> → archive a thread (soft; never deletes)
 * Auth: founder blvstack_admin session, enforced by middleware.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const includeArchived = url.searchParams.get('all') === '1';
  const threads = await listThreads({ includeArchived });
  return json({ threads });
};

export const POST: APIRoute = async ({ locals, url, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);

  const archiveId = url.searchParams.get('archive');
  if (archiveId) {
    const unarchive = url.searchParams.get('unarchive') === '1';
    const result = await archiveThread(archiveId, !unarchive);
    return json(result);
  }

  let body: { title?: string; client_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const title = body.title?.trim();
  if (!title) return json({ error: 'Missing title' }, 400);
  const thread = await createThread({ title, client_id: body.client_id ?? null });
  return json({ thread });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
