import type { APIRoute } from 'astro';
import { anthropic } from '../../../../../lib/anthropic';
import { JANET_MODEL } from '../../../../../lib/janet/config';
import { getDoc, snapshotVersion, docToMarkdown } from '../../../../../lib/janet/docs';

export const prerender = false;
export const maxDuration = 60;

/**
 * POST /api/janet/docs/[id]/assist — inline AI edit (spec Feature 2).
 * Body: { op: 'rewrite'|'expand'|'tighten'|'restructure', text: string }
 *   - rewrite/expand/tighten operate on `text` (the selection) → return replacement
 *   - restructure operates on `text` (whole-doc markdown) → return new markdown
 * The CURRENT doc content is versioned first (non-negotiable #3 — never a silent
 * overwrite of Blue's writing), then the transform is returned for the editor to
 * apply. Auth: founder session (middleware).
 */
const OPS: Record<string, string> = {
  rewrite: 'Rewrite the following text to be clearer and stronger, keeping the same meaning and roughly the same length. Return only the rewritten text, no preamble.',
  expand: 'Expand the following text with more detail and substance, staying on point. Return only the expanded text, no preamble.',
  tighten: 'Tighten the following text — cut filler, make it crisp, keep every real point. Return only the tightened text, no preamble.',
  restructure: 'Restructure the following document for better flow and hierarchy. Keep all the content and meaning; improve headings, ordering, and grouping. Return the full document as clean markdown, no preamble.',
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const op = String(body.op ?? '');
  const text = String(body.text ?? '');
  if (!OPS[op]) return json({ error: 'Unknown op' }, 400);
  if (!text.trim()) return json({ error: 'Nothing to edit' }, 400);

  const doc = await getDoc(params.id!);
  if (!doc) return json({ error: 'Not found' }, 404);

  // Version the current state BEFORE returning an edit (non-negotiable #3).
  await snapshotVersion(params.id!, doc.content, `before JANET ${op}`, 'janet');

  try {
    const resp = await anthropic.messages.create({
      model: JANET_MODEL,
      max_tokens: 2000,
      system:
        'You are JANET, editing a document with Blue. Match his voice: concise, direct, competent, no filler, no emojis. Output only the edited text — no commentary, no code fences unless the content itself is code.',
      messages: [{ role: 'user', content: `${OPS[op]}\n\nContext — this is part of a "${doc.doc_type ?? 'general'}" doc titled "${doc.title}".\n\n---\n${text}` }],
    });
    const out = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    return json({ text: out, scope: op === 'restructure' ? 'doc' : 'selection' });
  } catch (e: any) {
    return json({ error: e?.message ?? 'Assist failed' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
