import type { APIRoute } from 'astro';
import { createResetToken } from '../../../lib/admin-session';
import { resend, FROM_EMAIL } from '../../../lib/resend';
import { wrapEmail } from '../../../lib/email-template';
import { rateLimit, getIP } from '../../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const ip = getIP(request);

  // Rate limit: 3 reset requests / hour per IP
  const rl = rateLimit(`admin-forgot:${ip}`, { limit: 3, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return redirect('/admin/forgot?sent=1', 302); // always look successful
  }

  const form = await request.formData();
  const email = (form.get('email') ?? '').toString();

  const token = await createResetToken(email);

  // Always show "sent" — don't leak whether the email matched
  if (!token) {
    return redirect('/admin/forgot?sent=1', 302);
  }

  const resetUrl = `${url.origin}/admin/reset/${token}`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Reset your BLVSTACK admin password',
      html: wrapEmail({
        preheader: 'A password reset was requested for your admin account.',
        eyebrow: '// Reset password',
        title: 'Reset your password',
        body: `
          <p style="margin:0 0 16px 0;">A password reset was requested for the BLVSTACK admin console.</p>
          <p style="margin:0 0 16px 0; color:#94A3B8;">
            The link below is valid for 30 minutes. If you didn't request this, ignore the email — your current password stays active.
          </p>
        `,
        cta: { label: 'Set new password', href: resetUrl },
        signoff: `<p style="margin:0; color:#94A3B8; font-family:ui-monospace,monospace; font-size:11px; letter-spacing:0.2em; text-transform:uppercase;">BLVSTACK security</p>`,
      }),
    });
  } catch (err) {
    console.error('[admin-forgot] email send failed', err);
  }

  return redirect('/admin/forgot?sent=1', 302);
};
