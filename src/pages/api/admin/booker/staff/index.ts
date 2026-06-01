import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { hashStaffPassword } from '../../../../../lib/booker/booker-session';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

/** GET — list staff (owner-only). */
export const GET: APIRoute = async ({ locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from('booker_staff')
    .select('id, created_at, email, name, role, active, last_login_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return j({ error: error.message }, 500);

  // Attach assignment count
  const ids = (data ?? []).map((s: any) => s.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: assigns } = await supabaseAdmin
      .from('booker_staff_assignments')
      .select('staff_id')
      .in('staff_id', ids);
    for (const a of assigns ?? []) {
      counts[a.staff_id] = (counts[a.staff_id] ?? 0) + 1;
    }
  }

  const staff = (data ?? []).map((s: any) => ({ ...s, assignment_count: counts[s.id] ?? 0 }));
  return j({ staff });
};

/** POST — create staff member (owner-only). */
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const name = body.name?.trim() ?? null;
  const role = body.role as string;

  if (!email || !password) return j({ error: 'email + password required' }, 400);
  if (!['owner', 'manager', 'agent'].includes(role)) return j({ error: 'invalid role' }, 400);
  if (password.length < 10) return j({ error: 'Password must be ≥ 10 chars' }, 400);

  let hash: string;
  try {
    hash = await hashStaffPassword(password);
  } catch (err: any) {
    return j({ error: err?.message ?? 'Hash failed' }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from('booker_staff')
    .insert({ email, password_hash: hash, name, role, active: true })
    .select('id, email, name, role, active, created_at')
    .single();

  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, staff: data });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
