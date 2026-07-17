import type { APIRoute } from 'astro';
import { verifyResendRequest } from '../../../lib/resend-webhook';
import { updateSentStatusByResendId, type SentStatus } from '../../../lib/janet/sent';

export const prerender = false;

// Resend delivery webhook → updates janet_sent_emails.status. Public route (not
// behind admin auth), so it MUST verify the Svix signature Resend sends. Set
// RESEND_WEBHOOK_SECRET (whsec_…, comma-separated for multiple accounts) from
// the Resend dashboard webhook config. Verification is shared with the outbound
// webhook via lib/resend-webhook.ts.

const EVENT_STATUS: Record<string, SentStatus> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

export const POST: APIRoute = async ({ request }) => {
  const { ok, raw, configured } = await verifyResendRequest(request);
  if (!configured) return json({ error: 'Webhook not configured' }, 503);
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const status = EVENT_STATUS[evt?.type];
  const emailId = evt?.data?.email_id;
  if (status && typeof emailId === 'string') {
    await updateSentStatusByResendId(emailId, status);
  }
  // Always 200 so Resend doesn't retry events we intentionally ignore.
  return json({ ok: true });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
