import type { APIRoute } from 'astro';
import { runSendBatch } from '../../../../lib/outbound/engine';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const result = await runSendBatch();
    return j({ ok: true, ...result });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Send batch failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
