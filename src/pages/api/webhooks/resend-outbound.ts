import type { APIRoute } from 'astro';
import { processBounce } from '../../../lib/outbound/engine';
import { processBounce as bookerProcessBounce } from '../../../lib/booker/engine';
import { verifyResendRequest } from '../../../lib/resend-webhook';
import { updateSentStatusByResendId, type SentStatus } from '../../../lib/janet/sent';
import { promoteLedgerByResendId } from '../../../lib/janet/verify';

export const prerender = false;

/**
 * POST /api/webhooks/resend-outbound
 * Receives Resend webhook events for the tryblvstack.com account — BOTH the cold
 * outbound (SunResponse) and BLVBooker lanes send from it:
 * - email.bounced   → suppress the address + mark the prospect AND the venue dead
 * - email.complained → treat as unsubscribe (same suppression)
 * - email.delivered → (logged; ledger promotion handled above by email_id)
 *
 * PUBLIC route (Resend calls it) that mutates suppression state, so it MUST fully
 * verify the Svix signature — an unverified POST could suppress at will. (5.5 —
 * booker bounces route through THIS verified webhook; the old unverified
 * /api/webhooks/booker-reply endpoint was deleted.)
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

  // Reconcile the sent-log + action ledger by the Resend id — independent of the
  // prospect/suppression logic below. Delivery promotes the ledger executed→verified;
  // a bounce/complaint marks it failed. This is the delivery-truth path for the
  // outbound + booker lanes (2.3), keyed by the id the executor stored.
  const LEDGER_EVENT_STATUS: Record<string, SentStatus> = {
    'email.delivered': 'delivered',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
  };
  const emailId = body?.data?.email_id;
  if (typeof emailId === 'string' && LEDGER_EVENT_STATUS[eventType]) {
    await updateSentStatusByResendId(emailId, LEDGER_EVENT_STATUS[eventType]);
    await promoteLedgerByResendId(emailId, eventType);
  }

  try {
    switch (eventType) {
      case 'email.bounced': {
        const toEmail = body.data?.to?.[0];
        if (toEmail) {
          // Suppress in BOTH lanes — a bounced address is a prospect XOR a venue
          // (or neither); each call no-ops if the address isn't in that system (5.5).
          await processBounce(toEmail);
          await bookerProcessBounce(toEmail);
          console.log(`[webhook] Bounce processed (outbound + booker): ${toEmail}`);
        }
        break;
      }

      case 'email.complained': {
        // Spam complaint = treat as unsubscribe, both lanes.
        const toEmail = body.data?.to?.[0];
        if (toEmail) {
          await processBounce(toEmail);
          await bookerProcessBounce(toEmail);
          console.log(`[webhook] Complaint processed (outbound + booker): ${toEmail}`);
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
