import type { APIRoute } from 'astro';
import { processInboundReply, processBounce } from '../../../lib/outbound/engine';
import { verifyResendRequest } from '../../../lib/resend-webhook';

export const prerender = false;

/**
 * POST /api/webhooks/resend-outbound
 * Receives Resend webhook events for outbound emails:
 * - email.bounced → mark prospect as dead, add to suppression
 * - email.delivered → (logged, no action needed)
 * - email.complained → treat as unsubscribe
 *
 * PUBLIC route (Resend calls it) that mutates prospect/suppression state, so it
 * MUST fully verify the Svix signature — same as /api/webhooks/resend. An
 * unverified POST here could suppress prospects at will.
 */
export const POST: APIRoute = async ({ request }) => {
  const { ok, raw, configured } = await verifyResendRequest(request);
  if (!configured) return j({ error: 'Webhook not configured' }, 503);
  if (!ok) return j({ error: 'Invalid signature' }, 401);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const eventType = body.type;

  try {
    switch (eventType) {
      case 'email.bounced': {
        const toEmail = body.data?.to?.[0];
        if (toEmail) {
          await processBounce(toEmail);
          console.log(`[webhook] Bounce processed: ${toEmail}`);
        }
        break;
      }

      case 'email.complained': {
        // Spam complaint = treat as unsubscribe
        const toEmail = body.data?.to?.[0];
        if (toEmail) {
          await processBounce(toEmail); // Same handling as bounce
          console.log(`[webhook] Complaint processed: ${toEmail}`);
        }
        break;
      }

      case 'email.delivered': {
        // Just log — no action needed
        console.log(`[webhook] Delivered: ${body.data?.to?.[0]}`);
        break;
      }

      default:
        console.log(`[webhook] Unhandled event: ${eventType}`);
    }
  } catch (err: any) {
    console.error(`[webhook] Error processing ${eventType}:`, err);
    return j({ error: err?.message ?? 'Processing failed' }, 500);
  }

  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
