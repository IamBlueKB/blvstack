import type { APIRoute } from 'astro';
import { processInboundReply, processBounce } from '../../../lib/outbound/engine';

export const prerender = false;

const WEBHOOK_SECRET = import.meta.env.RESEND_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/resend-outbound
 * Receives Resend webhook events for outbound emails:
 * - email.bounced → mark prospect as dead, add to suppression
 * - email.delivered → (logged, no action needed)
 * - email.complained → treat as unsubscribe
 *
 * Also handles inbound forwarded replies if configured.
 */
export const POST: APIRoute = async ({ request }) => {
  // Verify webhook signature if secret is set
  if (WEBHOOK_SECRET) {
    const signature = request.headers.get('svix-signature');
    if (!signature) {
      return j({ error: 'Missing signature' }, 401);
    }
    // Note: For production, use svix package to verify. For now, basic check.
  }

  let body: any;
  try {
    body = await request.json();
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
