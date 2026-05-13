import type { APIRoute } from 'astro';
import { verifyLogin, setAdminSession } from '../../../lib/admin-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = (form.get('email') ?? '').toString();
  const password = (form.get('password') ?? '').toString();

  const verifiedEmail = await verifyLogin(email, password);
  if (!verifiedEmail) {
    return redirect('/admin/login?error=invalid', 302);
  }

  setAdminSession(cookies, verifiedEmail);
  return redirect('/admin', 302);
};
