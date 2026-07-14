import type { APIRoute } from 'astro';
import { listDocs, createDoc, buildTemplate, markdownToBlocks, type DocType } from '../../../../lib/janet/docs';

export const prerender = false;

/**
 * GET  /api/janet/docs?client_id=&all=1   → list docs (with client_name)
 * POST /api/janet/docs                      → create { title, client_id?, deal_id?,
 *   recommendation_id?, doc_type?, markdown? | template? }
 * Auth: founder blvstack_admin session (middleware).
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const docs = await listDocs({
    clientId: url.searchParams.get('client_id'),
    includeArchived: url.searchParams.get('all') === '1',
  });
  return json({ docs });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const title = (body.title ?? '').trim();
  if (!title) return json({ error: 'Missing title' }, 400);

  const content = body.template
    ? await buildTemplate(body.template as DocType, body.client_id ?? null)
    : body.markdown
      ? markdownToBlocks(body.markdown)
      : [];

  const doc = await createDoc({
    title,
    client_id: body.client_id ?? null,
    deal_id: body.deal_id ?? null,
    recommendation_id: body.recommendation_id ?? null,
    doc_type: body.doc_type ?? body.template ?? 'general',
    content,
  });
  return json({ doc });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
