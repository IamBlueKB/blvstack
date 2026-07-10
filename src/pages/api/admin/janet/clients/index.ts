import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;

export function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const STATUSES = ['prospect', 'active', 'past'];

export function normalizeClient(b: any): Record<string, unknown> {
  const s = (k: string) => (typeof b[k] === 'string' && b[k].trim() ? b[k].trim() : null);
  return {
    name: b.name?.trim(),
    contact_name: s('contact_name'),
    contact_email: s('contact_email'),
    contact_phone: s('contact_phone'),
    status: STATUSES.includes(b.status) ? b.status : 'active',
    notes: s('notes'),
    approver_name: s('approver_name'),
    approver_email: s('approver_email'),
    approver_role: s('approver_role'),
  };
}

/** GET /api/admin/janet/clients — accounts with rollup counts. */
export const GET: APIRoute = async () => {
  const [clientsRes, sitesRes, dealsRes] = await Promise.all([
    supabaseAdmin.from('janet_clients').select('*').order('name'),
    supabaseAdmin.from('janet_sites').select('client_id'),
    supabaseAdmin.from('janet_deals').select('client_id'),
  ]);
  if (clientsRes.error) return j({ error: clientsRes.error.message }, 500);
  const countBy = (rows: any[]) => {
    const m: Record<string, number> = {};
    for (const r of rows ?? []) if (r.client_id) m[r.client_id] = (m[r.client_id] ?? 0) + 1;
    return m;
  };
  const siteCounts = countBy(sitesRes.data ?? []);
  const dealCounts = countBy(dealsRes.data ?? []);
  const clients = (clientsRes.data ?? []).map((c) => ({ ...c, site_count: siteCounts[c.id] ?? 0, deal_count: dealCounts[c.id] ?? 0 }));
  return j({ clients });
};

/** POST /api/admin/janet/clients — create an account. */
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!b?.name?.trim()) return j({ error: 'name required' }, 400);
  const { data, error } = await supabaseAdmin.from('janet_clients').insert(normalizeClient(b)).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ client: data });
};
