import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { updateSentStatusByResendId, type SentStatus } from '../../../lib/janet/sent';

export const prerender = false;

// Resend delivery webhook → updates janet_sent_emails.status. Public route (not
// behind admin auth), so it MUST verify the Svix signature Resend sends. Set
// RESEND_WEBHOOK_SECRET (whsec_…) from the Resend dashboard webhook config.

const EVENT_STATUS: Record<string, SentStatus> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

/** Verify a Svix-signed webhook (Resend uses Svix). Signature =
 *  base64(HMAC-SHA256(secretBytes, `${id}.${timestamp}.${body}`)). */
function verify(secret: string, id: string, ts: string, body: string, header: string): boolean {
  if (!secret || !id || !ts || !header) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  // Header is a space-separated list of `v1,<sig>` — any match passes.
  for (const part of header.split(' ')) {
    const sig = part.split(',')[1];
    if (!sig) continue;
    try {
      const got = Buffer.from(sig, 'base64');
      if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
    } catch { /* malformed sig segment */ }
  }
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook not configured' }, 503);

  const raw = await request.text();
  const id = request.headers.get('svix-id') ?? '';
  const ts = request.headers.get('svix-timestamp') ?? '';
  const sig = request.headers.get('svix-signature') ?? '';
  if (!verify(secret, id, ts, raw, sig)) return json({ error: 'Invalid signature' }, 401);

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
