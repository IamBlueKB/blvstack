import type { APIRoute } from 'astro';
import { getDoc, updateDoc, archiveDoc } from '../../../../lib/janet/docs';

export const prerender = false;

/**
 * GET    /api/janet/docs/[id]         → full doc row
 * PUT    /api/janet/docs/[id]         → update { title?, content?, doc_type?, deal_id?, recommendation_id? }
 *   Pass ?snapshot=1 to version the current content first (used for manual saves).
 * DELETE /api/janet/docs/[id]         → archive (soft; ?unarchive=1 to restore)
 * Auth: founder blvstack_admin session (middleware).
 */
export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const doc = await getDoc(params.id!);
  if (!doc) return json({ error: 'Not found' }, 404);
  return json({ doc });
};

export const PUT: APIRoute = async ({ locals, params, request, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const patch: any = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (Array.isArray(body.content)) patch.content = body.content;
  if (typeof body.doc_type === 'string') patch.doc_type = body.doc_type;
  if ('deal_id' in body) patch.deal_id = body.deal_id ?? null;
  if ('recommendation_id' in body) patch.recommendation_id = body.recommendation_id ?? null;
  const snapshot = url.searchParams.get('snapshot') === '1' || body.snapshot === true;
  const doc = await updateDoc(params.id!, patch, snapshot ? { snapshot: { label: body.snapshot_label ?? 'manual save', created_by: 'blue' } } : {});
  return json({ doc });
};

export const DELETE: APIRoute = async ({ locals, params, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const result = await archiveDoc(params.id!, url.searchParams.get('unarchive') !== '1');
  return json(result);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
