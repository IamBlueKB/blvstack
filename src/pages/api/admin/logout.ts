import type { APIRoute } from 'astro';
import { clearAdminSession } from '../../../lib/admin-session';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  clearAdminSession(cookies);
  return redirect('/admin/login', 302);
};
