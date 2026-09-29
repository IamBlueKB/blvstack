/**
 * POST /api/assessment — the free project assessment (blvstack.com/assessment).
 * Body: { need, current_site?, goals[], about, timeline, name, email, phone?, hp, turnstile_token }
 * Returns the high-level brief to render; the same brief is emailed after the
 * response (src/lib/assessment.ts).
 */
import type { APIRoute } from 'astro';
import { parseAssessment, submitAssessment } from '../../lib/assessment';
import { rateLimit, getIP } from '../../lib/rate-limit';
import { verifyTurnstile } from '../../lib/turnstile';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const ip = getIP(request);
  if (!rateLimit(`assessment:${ip}`, { limit: 8, windowMs: 60 * 60 * 1000 }).allowed) {
    return json({ error: 'Too many submissions — please try again later.' }, 429);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid request.' }, 400);

  // Honeypot — a hidden field no human fills. Accept silently, save nothing.
  if (body.hp && String(body.hp).trim()) return json({ ok: true, brief: null });

  // Turnstile — reject if it doesn't pass (skipped only if no secret is set). Dev pairs
  // the form's test site key with Cloudflare's always-pass test secret.
  const secret = import.meta.env.DEV ? '1x0000000000000000000000000000000AA' : import.meta.env.TURNSTILE_SECRET_KEY;
  if (secret && !(await verifyTurnstile(secret, body.turnstile_token, ip))) {
    return json({ error: 'Verification failed — please retry.' }, 400);
  }

  const parsed = parseAssessment(body);
  if ('error' in parsed) return json({ error: parsed.error }, 400);

  try {
    const { brief } = await submitAssessment(parsed.input, ip);
    return json({ ok: true, brief });
  } catch (e) {
    console.error('[assessment] submit failed:', (e as Error).message);
    return json({ error: 'Something went wrong on our side — please try again.' }, 500);
  }
};

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}
