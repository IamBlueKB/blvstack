import type { APIRoute } from 'astro';
import { changePassword } from '../../../../lib/admin-session';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!body.currentPassword || !body.newPassword) {
    return j({ error: 'Missing fields' }, 400);
  }

  const result = await changePassword(body.currentPassword, body.newPassword);
  if (!result.ok) return j({ error: result.error }, 400);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
