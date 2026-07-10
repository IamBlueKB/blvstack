import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

/** POST /api/admin/janet/deals — create a deal from the form.
 *  Same janet_deals table JANET's create_deal tool writes to — one row, no
 *  duplicates: chat-created and form-created deals are the same records. */
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!b?.name?.trim()) return j({ error: 'name required' }, 400);
  const { data, error } = await supabaseAdmin.from('janet_deals').insert(normalizeDeal(b)).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ deal: data });
};

export function normalizeDeal(b: any): Record<string, unknown> {
  const s = (k: string) => (typeof b[k] === 'string' && b[k].trim() ? b[k].trim() : null);
  const row: Record<string, unknown> = {
    name: b.name?.trim(),
    contact_name: s('contact_name'),
    contact_email: s('contact_email'),
    source: s('source'),
    referred_by: s('referred_by'),
    stage: s('stage') ?? 'inquiry',
    value_estimate: b.value_estimate === '' || b.value_estimate == null ? null : Number(b.value_estimate),
    next_action: s('next_action'),
    next_action_due: s('next_action_due'),
    notes: s('notes'),
    site_id: s('site_id'),
    client_id: s('client_id'),
  };
  return row;
}

export function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
