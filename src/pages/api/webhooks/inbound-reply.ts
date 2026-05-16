import type { APIRoute } from 'astro';
import { processInboundReply } from '../../../lib/outbound/engine';

export const prerender = false;

const INBOUND_SECRET = import.meta.env.INBOUND_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/inbound-reply
 * Receives inbound email notifications when someone replies
 * to an outbound email sent from tryblvstack.com.
 *
 * Can be called by:
 * - Cloudflare Email Workers
 * - Any email forwarding service that supports webhooks
 *
 * Body: { from: string, subject: string, body: string, secret?: string }
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: {
    from?: string;
    subject?: string;
    body?: string;
    text?: string;
    secret?: string;
  };

  try {
    payload = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  // Verify secret
  if (INBOUND_SECRET && payload.secret !== INBOUND_SECRET) {
    return j({ error: 'Invalid secret' }, 401);
  }

  const from = payload.from;
  const subject = payload.subject ?? '';
  const body = payload.body ?? payload.text ?? '';

  if (!from) {
    return j({ error: 'Missing from address' }, 400);
  }

  // Extract email from "Name <email>" format
  const emailMatch = from.match(/<([^>]+)>/) ?? [null, from];
  const senderEmail = (emailMatch[1] ?? from).trim();

  try {
    const result = await processInboundReply(senderEmail, subject, body);

    if (result.matched) {
      console.log(`[inbound] Reply matched to prospect ${result.prospectId}: ${result.action}`);
    } else {
      console.log(`[inbound] No prospect match for ${senderEmail}`);
    }

    return j({ ok: true, ...result });
  } catch (err: any) {
    console.error('[inbound] Error:', err);
    return j({ error: err?.message ?? 'Processing failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
