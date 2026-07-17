import { createHmac, timingSafeEqual } from 'node:crypto';

// Shared Svix verification for Resend webhooks. Multiple Resend accounts
// (blvstack.com + tryblvstack.com) each have their own webhook secret — set
// RESEND_WEBHOOK_SECRET to a comma-separated list and any matching secret passes.

/** The configured webhook signing secrets (comma-separated whsec_… values). */
export function webhookSecrets(): string[] {
  return String(import.meta.env.RESEND_WEBHOOK_SECRET ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
}

/** Verify a Svix-signed webhook. Signature = base64(HMAC-SHA256(secretBytes,
 *  `${id}.${timestamp}.${body}`)); the header is a space-separated list of
 *  `v1,<sig>` — any secret × any sig matching passes. Constant-time compare. */
export function verifySvix(secrets: string[], id: string, ts: string, body: string, header: string): boolean {
  if (!secrets.length || !id || !ts || !header) return false;
  const sigs = header.split(' ').map((p) => p.split(',')[1]).filter(Boolean);
  for (const secret of secrets) {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
    for (const sig of sigs) {
      try {
        const got = Buffer.from(sig, 'base64');
        if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
      } catch {
        /* malformed sig segment */
      }
    }
  }
  return false;
}

/** Read the Svix headers + raw body and verify. Reads the body ONCE (needed
 *  for the signature, which is computed over the exact raw payload). */
export async function verifyResendRequest(request: Request): Promise<{ ok: boolean; raw: string; configured: boolean }> {
  const secrets = webhookSecrets();
  const raw = await request.text();
  if (!secrets.length) return { ok: false, raw, configured: false };
  const id = request.headers.get('svix-id') ?? '';
  const ts = request.headers.get('svix-timestamp') ?? '';
  const sig = request.headers.get('svix-signature') ?? '';
  return { ok: verifySvix(secrets, id, ts, raw, sig), raw, configured: true };
}
