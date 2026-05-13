import type { APIRoute } from 'astro';
import { checkPassword, setAdminSession } from '../../../lib/admin-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = (form.get('email') ?? '').toString();
  const password = (form.get('password') ?? '').toString();

  if (!checkPassword(email, password)) {
    return redirect('/admin/login?error=invalid', 302);
  }

  setAdminSession(cookies, email.trim().toLowerCase());
  return redirect('/admin', 302);
};
