import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { getDoc, createDoc, updateDoc, blockId, type DocBlock } from '../../../../lib/janet/docs';

export const prerender = false;

/**
 * POST /api/janet/docs/clip — highlight-to-doc (spec Feature 2).
 * Body: { text, source?, doc_id?, client_id?, client_name? }
 *   - doc_id given → append to that doc
 *   - else client_id → append to that client's "Clippings" doc (created if needed)
 *   - else → a standalone "Clippings" doc
 * Each clip lands with a light source-attribution line so it isn't orphaned.
 * The doc does NOT need to be open. Auth: founder session (middleware).
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const text = String(body.text ?? '').trim();
  if (!text) return json({ error: 'Nothing to send' }, 400);

  // Resolve the destination doc.
  let doc = body.doc_id ? await getDoc(body.doc_id) : null;
  if (!doc) {
    const clientId = body.client_id ?? null;
    // Reuse an existing Clippings doc for this scope, else create one.
    let q = supabaseAdmin.from('janet_docs').select('id').eq('status', 'active').eq('doc_type', 'notes').ilike('title', '%clippings%').limit(1);
    q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);
    const { data: existing } = await q.maybeSingle();
    if (existing) doc = await getDoc(existing.id);
    if (!doc) {
      const title = clientId ? `${body.client_name ?? 'Client'} — Clippings` : 'Clippings';
      doc = await createDoc({ title, client_id: clientId, doc_type: 'notes', content: [] });
    }
  }

  const when = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const attribution = `— from JANET · ${when}${body.source ? ` · ${body.source}` : ''}`;
  const clipBlocks: DocBlock[] = [
    { id: blockId(), type: 'text', text },
    { id: blockId(), type: 'text', text: attribution },
  ];
  const content = [...(doc.content ?? []), ...clipBlocks];
  const updated = await updateDoc(doc.id, { content }, {});
  const clipCount = (updated.content ?? []).filter((b) => b.type === 'text' && b.text.startsWith('— from JANET')).length;
  return json({ doc_id: updated.id, title: updated.title, url: `/admin/docs/${updated.id}`, clip_count: clipCount });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
