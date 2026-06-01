import type { APIRoute } from 'astro';
import { researchVenueAndSave } from '../../../../../../lib/booker/engine';
import { requireActor } from '../../../../../../lib/booker/access';

export const prerender = false;

/** All roles can trigger research (read-only side effect on venue row). */
export const POST: APIRoute = async ({ params, locals }) => {
  requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  try {
    const result = await researchVenueAndSave(id);
    return j(result);
  } catch (err: any) {
    return j({ error: err?.message ?? 'Research failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
