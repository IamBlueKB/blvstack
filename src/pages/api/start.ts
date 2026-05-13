import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { rateLimit, getIP } from '../../lib/rate-limit';

export const prerender = false;

type ApplyPayload = {
  name?: string;
  businessName?: string;
  websiteUrl?: string;
  revenueRange?: string;
  problem?: string;
  timeline?: string;
  budgetTier?: string;
  email?: string;
  phone?: string;
  hp?: string;       // honeypot
  service?: string;  // preselect from /services
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

  // Rate limit: max 3 submissions / 24h per IP
  const rl = rateLimit(`apply:${ip}`, { limit: 3, windowMs: 24 * 60 * 60 * 1000 });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: ApplyPayload;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Honeypot — silently reject
  if (body.hp && body.hp.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  const required = ['name', 'email', 'problem', 'revenueRange', 'timeline', 'budgetTier'] as const;
  for (const field of required) {
    if (!body[field] || (body[field] as string).trim() === '') {
      return new Response(
        JSON.stringify({ error: `Missing required field: ${field}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Email shape check
  if (!/^\S+@\S+\.\S+$/.test(body.email!)) {
    return new Response(JSON.stringify({ error: 'Invalid email.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Insert lead into Supabase
  const { data: lead, error: dbErr } = await supabaseAdmin
    .from('leads')
    .insert({
      name: body.name,
      email: body.email,
      phone: body.phone ?? null,
      business_name: body.businessName ?? null,
      website_url: body.websiteUrl ?? null,
      revenue_range: body.revenueRange,
      problem: body.problem,
      timeline: body.timeline,
      budget_tier: body.budgetTier,
      source: body.service ? `apply_form:${body.service}` : 'apply_form',
      status: 'new',
      ip_address: ip,
    })
    .select()
    .single();

  if (dbErr) {
    console.error('[apply] supabase insert error', dbErr);
    return new Response(
      JSON.stringify({ error: 'Could not save submission. Try again in a moment.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Notify founder + send applicant auto-reply (don't fail submission if email errors)
  try {
    await Promise.all([
      // 1. Founder notification — full submission detail
      resend.emails.send({
        from: FROM_EMAIL,
        to: FOUNDER_EMAIL,
        subject: `[BLVSTACK] New application — ${body.name}`,
        replyTo: body.email,
        html: `
          <h2 style="font-family: sans-serif;">New application</h2>
          <table style="font-family: sans-serif; font-size: 14px; line-height: 1.6;">
            <tr><td><strong>Name</strong></td><td>${escapeHtml(body.name ?? '')}</td></tr>
            <tr><td><strong>Email</strong></td><td><a href="mailto:${escapeHtml(body.email ?? '')}">${escapeHtml(body.email ?? '')}</a></td></tr>
            <tr><td><strong>Phone</strong></td><td>${escapeHtml(body.phone ?? '—')}</td></tr>
            <tr><td><strong>Business</strong></td><td>${escapeHtml(body.businessName ?? '—')}</td></tr>
            <tr><td><strong>Website</strong></td><td>${escapeHtml(body.websiteUrl ?? '—')}</td></tr>
            <tr><td><strong>Revenue</strong></td><td>${escapeHtml(body.revenueRange ?? '—')}</td></tr>
            <tr><td><strong>Timeline</strong></td><td>${escapeHtml(body.timeline ?? '—')}</td></tr>
            <tr><td><strong>Budget</strong></td><td>${escapeHtml(body.budgetTier ?? '—')}</td></tr>
            <tr><td><strong>Service preselect</strong></td><td>${escapeHtml(body.service ?? '—')}</td></tr>
          </table>
          <h3 style="font-family: sans-serif;">Problem</h3>
          <p style="font-family: sans-serif; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(body.problem ?? '')}</p>
          <p style="font-family: sans-serif; font-size: 12px; color: #666;">Lead ID: ${lead?.id ?? 'unknown'} · IP: ${ip}</p>
        `,
      }),
      // 2. Applicant auto-reply
      resend.emails.send({
        from: FROM_EMAIL,
        to: body.email!,
        subject: `Thanks — we'll be in touch within 24 hours`,
        html: `
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            Hey ${escapeHtml(body.name ?? '')},
          </p>
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            Thanks for the application — it's in our queue.
          </p>
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            We review every qualified submission within 24 hours and respond directly if it's a fit. If you don't hear from us, it usually means the timing or scope isn't right for our current quarter.
          </p>
          <p style="font-family: sans-serif; font-size: 15px; line-height: 1.65;">
            — Blue<br/>
            BLVSTACK
          </p>
        `,
      }),
    ]);
  } catch (mailErr) {
    console.error('[apply] resend error', mailErr);
    // Don't fail submission — lead is already in DB
  }

  return new Response(JSON.stringify({ ok: true, id: lead?.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
