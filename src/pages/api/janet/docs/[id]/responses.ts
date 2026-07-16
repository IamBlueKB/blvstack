import type { APIRoute } from 'astro';
import { getFormResponses } from '../../../../../lib/janet/publish';

export const prerender = false;

/** GET /api/janet/docs/[id]/responses — form submissions for this doc (admin only). */
export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const responses = await getFormResponses(params.id!);
  return json({ responses });
};

function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
}
