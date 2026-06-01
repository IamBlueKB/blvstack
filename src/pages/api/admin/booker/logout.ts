import type { APIRoute } from 'astro';
import { clearStaffSession } from '../../../../lib/booker/booker-session';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  clearStaffSession(cookies);
  return redirect('/admin/booker/login', 302);
};
