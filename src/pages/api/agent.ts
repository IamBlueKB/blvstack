// Live public chat agent endpoint — streams Claude responses back to SimChatAgent.tsx.
// Anthropic SDK, AGENT_SYSTEM_PROMPT from src/lib/anthropic.ts, per-IP rate limit.

import type { APIRoute } from 'astro';
import { anthropic, MODEL, AGENT_SYSTEM_PROMPT } from '../../lib/anthropic';
import { rateLimit, getIP } from '../../lib/rate-limit';

export const prerender = false;
export const maxDuration = 60;

const MAX_USER_INPUT = 800;       // chars per message
const MAX_HISTORY = 16;            // last N messages sent to model
const RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 }; // 30 / hr / IP

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  // Rate limit per IP (in-memory; lives per serverless instance — best-effort)
  const ip = getIP(request);
  const rl = rateLimit(`agent:${ip}`, RATE_LIMIT);
  if (!rl.allowed) {
    return jsonError('Rate limit exceeded — try again later.', 429);
  }

  // Parse + validate body
  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = (raw as ChatMessage[])
    .filter(
      (m) =>
        m &&
        typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_USER_INPUT) }))
    .slice(-MAX_HISTORY);

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return jsonError('Last message must be from user', 400);
  }

  // Stream Claude response back as plain text chunks
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 800,
          system: AGENT_SYSTEM_PROMPT,
          messages,
          stream: true,
        });

        for await (const event of claudeStream as any) {
          if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta' &&
            typeof event.delta.text === 'string'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err: any) {
        const msg = err?.message ?? 'Agent error';
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
};
