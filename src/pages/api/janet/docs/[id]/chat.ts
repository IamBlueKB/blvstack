import type { APIRoute } from 'astro';
import { runJanetTurn, type JanetStreamEvent } from '../../../../../lib/janet/brain';
import { getDoc, ensureDocThread, docToMarkdown } from '../../../../../lib/janet/docs';

export const prerender = false;
export const maxDuration = 300;

/**
 * POST /api/janet/docs/[id]/chat — doc-aware chat (spec Feature 2).
 * Body: { message: string }
 * Streams the same SSE events as /api/janet/chat. Runs through the shared brain
 * so plan-approve-execute, memory, and audit all work identically — the doc's
 * live content is injected as page context so she reads the whole doc, and the
 * turn is persisted to the doc's own thread (created lazily). Auth: middleware.
 */
export const POST: APIRoute = async ({ request, locals, params }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const message = body.message?.trim();
  if (!message) return json({ error: 'Missing message' }, 400);

  const doc = await getDoc(params.id!);
  if (!doc) return json({ error: 'Not found' }, 404);
  const threadId = await ensureDocThread(params.id!);

  const pageContext = {
    path: `/admin/docs/${doc.id}`,
    entity_type: 'doc',
    entity_id: doc.id,
    client_id: doc.client_id ?? undefined,
    entity_summary: {
      title: doc.title,
      doc_type: doc.doc_type,
      // The whole doc, live — she reads it as context for anything you ask here.
      doc_markdown: docToMarkdown(doc),
      note: 'To draft into or revise THIS doc, call update_doc with id ' + doc.id + '. To file records from it, call file_records.',
    },
  };

  const encoder = new TextEncoder();
  // Stop control: client aborts its fetch → cancel() aborts the turn.
  const ac = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (ev: JanetStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* client disconnected — turn still completes + persists */
        }
      };
      await runJanetTurn({ message, pageContext, threadId, emit, signal: ac.signal });
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
