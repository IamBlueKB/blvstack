import type { APIRoute } from 'astro';
import { getPublishedBySlug, recordFormResponse } from '../../../lib/janet/publish';
import { docHasFields, normalizeSubmission, answersForDisplay } from '../../../lib/janet/doc-blocks';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../../lib/resend';
import { rateLimit, getIP } from '../../../lib/rate-limit';

export const prerender = false;

/**
 * POST /api/p/submit — public questionnaire submission for a published form.
 * Body: { slug, answers: {label: value}, respondent_name?, respondent_email?, turnstile_token }
 * Guards: Turnstile (spam), rate limit, and the slug must resolve to a real
 * PUBLISHED doc that actually HAS field blocks. Stores the response (PII →
 * service role only) tied to the doc's client, then emails Blue.
 */
export const POST: APIRoute = async ({ request }) => {
  const ip = getIP(request);
  const rl = rateLimit(`form-submit:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) return json({ error: 'Too many submissions. Try again later.' }, 429);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }

  // Honeypot — a hidden field no human fills. Bots do. Silently accept + drop
  // (always on, no external config). This is the baseline spam guard; Turnstile
  // adds to it when keyed + the domain is on the widget.
  if (body.hp && String(body.hp).trim()) return json({ ok: true });

  // Turnstile — reject if it doesn't pass (skipped only if no secret is set).
  const secret = import.meta.env.TURNSTILE_SECRET_KEY;
  if (secret) {
    const ok = await verifyTurnstile(secret, body.turnstile_token, ip);
    if (!ok) return json({ error: 'Verification failed. Please retry.' }, 400);
  }

  const slug = String(body.slug ?? '');
  const found = await getPublishedBySlug(slug);
  if (!found) return json({ error: 'This form is not available.' }, 404);
  const { page, doc } = found;
  if (!docHasFields(doc.content)) return json({ error: 'This page is not a form.' }, 400);

  // 5.1 — key by BLOCK ID (no label collision), snapshot each label at submit time,
  // and enforce required fields SERVER-side (client `required` is bypassable).
  const answersById = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const { answers, missing } = normalizeSubmission(doc.content, answersById);
  if (missing.length > 0) return json({ error: `Please fill in required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, missing }, 400);
  if (answers.length === 0) return json({ error: 'No answers submitted.' }, 400);

  await recordFormResponse({
    pageId: page.id,
    docId: doc.id,
    clientId: doc.client_id,
    answers,
    respondentName: body.respondent_name ? String(body.respondent_name).slice(0, 200) : null,
    respondentEmail: body.respondent_email ? String(body.respondent_email).slice(0, 200) : null,
    referrer: request.headers.get('referer'),
    userAgent: request.headers.get('user-agent'),
  });

  // Notify Blue (best-effort — never fail the submission on an email hiccup).
  try {
    const rows = answersForDisplay(answers).map(({ label, value }) => `<tr><td style="padding:4px 12px 4px 0;color:#64748B;font-size:12px;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;color:#111;font-size:13px">${esc(value)}</td></tr>`).join('');
    await resend.emails.send({
      from: FROM_EMAIL,
      to: FOUNDER_EMAIL,
      replyTo: body.respondent_email || undefined,
      subject: `[BLVSTACK] Form response — ${doc.title}`,
      html: `<div style="font-family:Arial,sans-serif"><p style="font-size:14px">New response to <b>${esc(doc.title)}</b>${body.respondent_name ? ` from ${esc(String(body.respondent_name))}` : ''}${body.respondent_email ? ` (${esc(String(body.respondent_email))})` : ''}.</p><table>${rows}</table><p style="font-size:12px;color:#888">View + file it in the doc's Responses panel.</p></div>`,
    });
  } catch (e) {
    console.error('[form-submit] notify failed:', (e as Error).message);
  }

  return json({ ok: true });
};

async function verifyTurnstile(secret: string, token: unknown, ip: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  try {
    const form = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const j = await r.json();
    return j.success === true;
  } catch {
    return false;
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
}
