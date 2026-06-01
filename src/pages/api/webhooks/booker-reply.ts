import type { APIRoute } from 'astro';
import { processInboundReply, processBounce } from '../../../lib/booker/engine';

export const prerender = false;

const BOOKER_WEBHOOK_SECRET = import.meta.env.BOOKER_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/booker-reply
 *
 * Two modes:
 *
 * 1. Resend bounce/complaint events (POST with { type, data })
 *    - type: 'email.bounced' | 'email.complained' | 'email.delivered'
 *    - data.to: array of recipient emails
 *
 * 2. Inbound reply forwarder (POST with { from, subject, body, secret })
 *    - from: sender email (or "Name <email>")
 *    - subject: reply subject
 *    - body: reply text
 *    - secret: must match BOOKER_WEBHOOK_SECRET
 *
 * Distinguishes by presence of `type` (Resend event) vs `from` (inbound).
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  // Resend event (no secret needed; Resend sends svix-signature header if configured)
  if (payload.type) {
    try {
      switch (payload.type) {
        case 'email.bounced':
        case 'email.complained': {
          const toEmail = payload.data?.to?.[0];
          if (toEmail) {
            await processBounce(toEmail);
            console.log(`[booker-webhook] ${payload.type}: ${toEmail}`);
          }
          break;
        }
        case 'email.delivered':
          console.log(`[booker-webhook] delivered: ${payload.data?.to?.[0]}`);
          break;
        default:
          console.log(`[booker-webhook] unhandled event: ${payload.type}`);
      }
    } catch (err: any) {
      console.error(`[booker-webhook] event error: ${err?.message}`);
      return j({ error: err?.message ?? 'Event processing failed' }, 500);
    }
    return j({ ok: true });
  }

  // Inbound reply forwarder
  if (payload.from) {
    if (BOOKER_WEBHOOK_SECRET && payload.secret !== BOOKER_WEBHOOK_SECRET) {
      return j({ error: 'Invalid secret' }, 401);
    }

    const from = payload.from as string;
    const subject = (payload.subject ?? '') as string;
    const body = (payload.body ?? payload.text ?? '') as string;

    const emailMatch = from.match(/<([^>]+)>/) ?? [null, from];
    const senderEmail = (emailMatch[1] ?? from).trim();

    try {
      const result = await processInboundReply(senderEmail, subject, body);
      return j({ ok: true, ...result });
    } catch (err: any) {
      console.error(`[booker-webhook] inbound error: ${err?.message}`);
      return j({ error: err?.message ?? 'Inbound processing failed' }, 500);
    }
  }

  return j({ error: 'Unrecognized payload' }, 400);
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
