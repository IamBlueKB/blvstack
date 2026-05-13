import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { rateLimit, getIP } from '../../lib/rate-limit';

export const prerender = false;

type ContactPayload = {
  name?: string;
  email?: string;
  message?: string;
  hp?: string;
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const POST: APIRoute = async ({ request }) => {
  const ip = getIP(request);

  // Rate limit: max 5 contact messages / 24h per IP
  const rl = rateLimit(`contact:${ip}`, { limit: 5, windowMs: 24 * 60 * 60 * 1000 });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many messages. Please try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: ContactPayload;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Honeypot — silently accept
  if (body.hp && body.hp.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate
  if (!body.name || !body.email || !body.message) {
    return new Response(JSON.stringify({ error: 'Missing required fields.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!/^\S+@\S+\.\S+$/.test(body.email)) {
    return new Response(JSON.stringify({ error: 'Invalid email.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (body.message.trim().length < 10) {
    return new Response(JSON.stringify({ error: 'Message too short.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Insert into Supabase contact_messages table
  const { data, error: dbErr } = await supabaseAdmin
    .from('contact_messages')
    .insert({
      name: body.name,
      email: body.email,
      message: body.message,
      status: 'new',
    })
    .select()
    .single();

  if (dbErr) {
    console.error('[contact] supabase insert error', dbErr);
    return new Response(
      JSON.stringify({ error: 'Could not save message. Try again in a moment.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Notify founder + send applicant auto-reply (best-effort, don't fail if email errors)
  try {
    await Promise.all([
      resend.emails.send({
        from: FROM_EMAIL,
        to: FOUNDER_EMAIL,
        subject: `[BLVSTACK] Contact — ${body.name}`,
        replyTo: body.email,
        html: `
          <h2 style="font-family: sans-serif;">New contact message</h2>
          <table style="font-family: sans-serif; font-size: 14px; line-height: 1.6;">
            <tr><td><strong>Name</strong></td><td>${escapeHtml(body.name)}</td></tr>
            <tr><td><strong>Email</strong></td><td><a href="mailto:${escapeHtml(body.email)}">${escapeHtml(body.email)}</a></td></tr>
          </table>
          <h3 style="font-family: sans-serif;">Message</h3>
          <p style="font-family: sans-serif; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(body.message)}</p>
          <p style="font-family: sans-serif; font-size: 12px; color: #666;">ID: ${data?.id ?? 'unknown'} · IP: ${ip}</p>
        `,
      }),
      resend.emails.send({
        from: FROM_EMAIL,
        to: body.email,
        subject: `Got it — we'll reply within 24 hours`,
        html: `
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            Hey ${escapeHtml(body.name)},
          </p>
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            Thanks — your message is in. We respond to every contact within 24 hours during business days.
          </p>
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            — Blue<br/>
            BLVSTACK
          </p>
        `,
      }),
    ]);
  } catch (mailErr) {
    console.error('[contact] resend error', mailErr);
  }

  return new Response(JSON.stringify({ ok: true, id: data?.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
