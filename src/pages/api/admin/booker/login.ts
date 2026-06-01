import type { APIRoute } from 'astro';
import { verifyStaffLogin, setStaffSession } from '../../../../lib/booker/booker-session';
import { rateLimit } from '../../../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const ip = clientAddress ?? 'unknown';
  if (!rateLimit(`booker-login:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 }).allowed) {
    return j({ error: 'Too many attempts. Try again later.' }, 429);
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) return j({ error: 'Email and password required' }, 400);

  const staff = await verifyStaffLogin(email, password);
  if (!staff) return j({ error: 'Invalid credentials' }, 401);

  setStaffSession(cookies, staff);
  return j({ ok: true, role: staff.role });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
