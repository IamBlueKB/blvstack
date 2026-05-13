import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { rateLimit, getIP } from '../../lib/rate-limit';
import { wrapEmail, dataTable, quoteBlock, metaLine, escapeHtml } from '../../lib/email-template';

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
        html: wrapEmail({
          preheader: `New application from ${body.name} — ${body.budgetTier}, ${body.timeline}`,
          eyebrow: '// New application',
          title: `${body.name} submitted an intake`,
          body: `
            ${dataTable([
              { label: 'Name', value: body.name ?? '' },
              { label: 'Email', value: body.email ?? '' },
              { label: 'Phone', value: body.phone ?? '—' },
              { label: 'Business', value: body.businessName ?? '—' },
              { label: 'Website', value: body.websiteUrl ?? '—' },
              { label: 'Revenue', value: body.revenueRange ?? '—' },
              { label: 'Timeline', value: body.timeline ?? '—' },
              { label: 'Budget', value: body.budgetTier ?? '—' },
              { label: 'Service', value: body.service ?? '—' },
            ])}
            ${quoteBlock('Problem', body.problem ?? '')}
            ${metaLine(`Lead ID: ${lead?.id ?? 'unknown'} · IP: ${ip}`)}
          `,
          cta: body.email ? { label: 'Reply', href: `mailto:${body.email}` } : undefined,
          signoff: `<p style="margin:0; color:#94A3B8; font-family:ui-monospace,monospace; font-size:11px; letter-spacing:0.2em; text-transform:uppercase;">Internal notification &middot; BLVSTACK ops</p>`,
        }),
      }),
      // 2. Applicant auto-reply
      resend.emails.send({
        from: FROM_EMAIL,
        to: body.email!,
        subject: `Thanks — we'll be in touch within 24 hours`,
        html: wrapEmail({
          preheader: `Your application is in. We review every submission within 24 hours.`,
          eyebrow: '// Application received',
          title: `Thanks, ${body.name}.`,
          body: `
            <p style="margin:0 0 16px 0;">Your application is in the queue.</p>
            <p style="margin:0 0 16px 0; color:#94A3B8;">
              We review every qualified submission within 24 hours and respond directly if it's a fit. If you don't hear from us, it usually means the timing or scope isn't right for our current quarter.
            </p>
            <p style="margin:0; color:#94A3B8;">
              In the meantime, the work we've shipped is on the site.
            </p>
          `,
          cta: { label: 'See recent work', href: 'https://blvstack.com/work' },
        }),
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
