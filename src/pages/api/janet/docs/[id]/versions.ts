import type { APIRoute } from 'astro';
import { listVersions, getVersion, restoreVersion } from '../../../../../lib/janet/docs';

export const prerender = false;

/**
 * GET  /api/janet/docs/[id]/versions            → version history (metadata)
 * GET  /api/janet/docs/[id]/versions?v=<id>     → one version's full content (preview)
 * POST /api/janet/docs/[id]/versions            → restore { version_id }
 * Auth: founder blvstack_admin session (middleware).
 */
export const GET: APIRoute = async ({ locals, params, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const vid = url.searchParams.get('v');
  if (vid) {
    const version = await getVersion(vid);
    if (!version || version.doc_id !== params.id) return json({ error: 'Not found' }, 404);
    return json({ version });
  }
  const versions = await listVersions(params.id!);
  return json({ versions });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.version_id) return json({ error: 'Missing version_id' }, 400);
  const doc = await restoreVersion(params.id!, body.version_id);
  return json({ doc });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
