import type { APIRoute } from 'astro';
import { runJanetTurn, type JanetStreamEvent } from '../../../lib/janet/brain';
import type { PageContext } from '../../../lib/janet/types';

export const prerender = false;
export const maxDuration = 300;

/**
 * POST /api/janet/chat
 * Body: { message: string, page_context?: PageContext }
 * Streams SSE events: text_delta | tool_start | tool_done | error | done.
 * Auth: founder blvstack_admin session, enforced by middleware (spec §4 /
 * Blue's 2026-07-09 confirmation). Belt-and-suspenders check below.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { message?: string; page_context?: PageContext; thread_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const message = body.message?.trim();
  if (!message) return json({ error: 'Missing message' }, 400);

  const encoder = new TextEncoder();
  // Stop control: the client aborts its fetch → the stream is cancelled → we
  // abort the turn so the model stops being called (stops spending).
  const ac = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (ev: JanetStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // Client disconnected mid-stream — swallow; the turn still completes
          // and persists server-side.
        }
      };
      await runJanetTurn({ message, pageContext: body.page_context ?? null, threadId: body.thread_id ?? null, emit, signal: ac.signal });
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
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
