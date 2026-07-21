import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

/**
 * POST /api/admin/clearear/services — create or update a Clear Ear service.
 * Body: { id?, name?, billing_type?, default_rate?, active?, sort_order? }.
 * With id → update those fields; without id → create (name + billing_type required).
 * Founder-gated (admin session).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);

  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const BILLING = ['hourly', 'flat', 'custom'];
  const patch: Record<string, unknown> = {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.billing_type === 'string' && BILLING.includes(b.billing_type)) patch.billing_type = b.billing_type;
  if (b.default_rate === null || b.default_rate === '') patch.default_rate = null;
  else if (b.default_rate != null && isFinite(Number(b.default_rate))) patch.default_rate = Number(b.default_rate);
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (b.sort_order != null && isFinite(Number(b.sort_order))) patch.sort_order = Number(b.sort_order);

  try {
    if (typeof b.id === 'string' && b.id) {
      if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);
      const { data, error } = await supabaseAdmin.from('clearear_services').update(patch).eq('id', b.id).select().single();
      if (error) throw new Error(error.message);
      return json({ ok: true, service: data });
    }
    if (!patch.name || !patch.billing_type) return json({ error: 'name and billing_type are required to create a service' }, 400);
    const { data, error } = await supabaseAdmin.from('clearear_services').insert(patch).select().single();
    if (error) throw new Error(error.message);
    return json({ ok: true, service: data });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
