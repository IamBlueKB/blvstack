import type { APIRoute } from 'astro';
import { runVenueBuild } from '../../../../../lib/booker/engine';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

/** POST { query, maxResults? } — Google Places search → insert venues. Manager+ only. */
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  let body: { query?: string; maxResults?: number };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const query = body.query?.trim();
  if (!query) return j({ error: 'Provide a search query' }, 400);
  const maxResults = Math.min(Math.max(body.maxResults ?? 20, 1), 60);

  try {
    const result = await runVenueBuild(query, maxResults);
    return j({ ok: true, ...result });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Find venues failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
