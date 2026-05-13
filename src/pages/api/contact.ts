import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { rateLimit, getIP } from '../../lib/rate-limit';
import { wrapEmail, dataTable, quoteBlock, metaLine } from '../../lib/email-template';

export const prerender = false;

type ContactPayload = {
  name?: string;
  email?: string;
  message?: string;
  hp?: string;
};

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
        html: wrapEmail({
          preheader: `New contact message from ${body.name}`,
          eyebrow: '// New contact message',
          title: `${body.name} sent a message`,
          body: `
            ${dataTable([
              { label: 'Name', value: body.name! },
              { label: 'Email', value: body.email! },
            ])}
            ${quoteBlock('Message', body.message!)}
            ${metaLine(`Message ID: ${data?.id ?? 'unknown'} · IP: ${ip}`)}
          `,
          cta: { label: 'Reply', href: `mailto:${body.email}` },
          signoff: `<p style="margin:0; color:#94A3B8; font-family:ui-monospace,monospace; font-size:11px; letter-spacing:0.2em; text-transform:uppercase;">Internal notification &middot; BLVSTACK ops</p>`,
        }),
      }),
      resend.emails.send({
        from: FROM_EMAIL,
        to: body.email,
        subject: `Got it — we'll reply within 24 hours`,
        html: wrapEmail({
          preheader: `Your message is in. We respond within 24 hours, business days.`,
          eyebrow: '// Message received',
          title: `Thanks, ${body.name}.`,
          body: `
            <p style="margin:0 0 16px 0;">Your message is in.</p>
            <p style="margin:0; color:#94A3B8;">
              We respond to every contact within 24 hours during business days. If your message is about a project, the intake form routes faster — but either way, you're in the queue.
            </p>
          `,
          cta: { label: 'Start a project', href: 'https://blvstack.com/start' },
        }),
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
