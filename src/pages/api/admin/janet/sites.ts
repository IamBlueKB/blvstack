import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

/** POST /api/admin/janet/sites — connect a site (create janet_sites row).
 *  Same table JANET's create_site tool writes to. */
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!b?.name?.trim() || !b?.production_url?.trim()) return j({ error: 'name and production_url required' }, 400);
  const { data, error } = await supabaseAdmin.from('janet_sites').insert(normalizeSite(b)).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ site: data });
};

export function normalizeSite(b: any): Record<string, unknown> {
  const s = (k: string) => (typeof b[k] === 'string' && b[k].trim() ? b[k].trim() : null);
  return {
    name: b.name?.trim(),
    production_url: b.production_url?.trim(),
    status: s('status') ?? 'active',
    client_name: s('client_name'),
    repo_url: s('repo_url'),
    retainer_status: s('retainer_status') ?? 'none',
    retainer_monthly: b.retainer_monthly === '' || b.retainer_monthly == null ? null : Number(b.retainer_monthly),
    notes: s('notes'),
    client_id: s('client_id'),
  };
}

export function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
