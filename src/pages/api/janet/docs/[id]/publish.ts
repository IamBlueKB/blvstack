import type { APIRoute } from 'astro';
import { publishPage, unpublishPage, getPageForDoc, getPageStats } from '../../../../../lib/janet/publish';

export const prerender = false;

/**
 * GET    /api/janet/docs/[id]/publish  → { page, stats } (current publish state + engagement)
 * POST   /api/janet/docs/[id]/publish  → publish { slug, indexable? }
 * DELETE /api/janet/docs/[id]/publish  → unpublish
 * Auth: founder blvstack_admin session (middleware).
 */
export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const page = await getPageForDoc(params.id!);
  const stats = page ? await getPageStats(page.id) : null;
  return json({ page, stats });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.slug) return json({ error: 'Missing slug' }, 400);
  try {
    const page = await publishPage({ docId: params.id!, slug: body.slug, indexable: body.indexable === true });
    return json({ page, url: `https://blvstack.com/${page.slug}` });
  } catch (e: any) {
    return json({ error: e?.message ?? 'Publish failed' }, 400);
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const res = await unpublishPage(params.id!);
  return json(res);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
