import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { hashStaffPassword } from '../../../../../../lib/booker/booker-session';
import { requireActor, requireRole } from '../../../../../../lib/booker/access';

export const prerender = false;

/** POST — owner sets a staff member's password directly (no current required). */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const password = body.password ?? '';
  if (password.length < 10) return j({ error: 'Password must be ≥ 10 chars' }, 400);

  let hash: string;
  try {
    hash = await hashStaffPassword(password);
  } catch (err: any) {
    return j({ error: err?.message ?? 'Hash failed' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('booker_staff')
    .update({ password_hash: hash })
    .eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
