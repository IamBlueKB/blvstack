import type { APIRoute } from 'astro';
import { consumeResetToken, setPasswordDirect } from '../../../lib/admin-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = (form.get('token') ?? '').toString();
  const newPassword = (form.get('newPassword') ?? '').toString();
  const confirmPassword = (form.get('confirmPassword') ?? '').toString();

  if (!token) return redirect('/admin/login?error=invalid', 302);

  if (newPassword !== confirmPassword) {
    return redirect(`/admin/reset/${token}?error=mismatch`, 302);
  }
  if (newPassword.length < 10) {
    return redirect(`/admin/reset/${token}?error=short`, 302);
  }

  const email = await consumeResetToken(token);
  if (!email) {
    return redirect('/admin/reset/invalid?error=invalid', 302);
  }

  const result = await setPasswordDirect(email, newPassword);
  if (!result.ok) {
    return redirect(`/admin/reset/${token}?error=fail`, 302);
  }

  return redirect('/admin/login?reset=1', 302);
};
