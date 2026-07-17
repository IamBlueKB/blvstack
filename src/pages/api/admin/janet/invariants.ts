import type { APIRoute } from 'astro';
import { runInvariants } from '../../../../lib/janet/invariants';

export const prerender = false;
export const maxDuration = 60;

/** GET /api/admin/janet/invariants — run the invariants probe on demand and
 *  return the results. Admin-gated by middleware. */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const result = await runInvariants();
  return json(result, result.ok ? 200 : 500);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
