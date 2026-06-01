import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  const vertical = url.searchParams.get('vertical');
  let query = supabaseAdmin.from('booker_sources').select('*').order('created_at', { ascending: false });
  if (vertical && vertical !== 'all') query = query.eq('vertical', vertical);
  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ sources: data ?? [] });
};

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
  const required = ['vertical', 'source_type', 'label', 'url'];
  for (const r of required) if (!body[r]) return j({ error: `${r} required` }, 400);
  const row: Record<string, unknown> = {
    vertical: body.vertical,
    source_type: body.source_type,
    label: body.label,
    url: body.url,
    city: body.city ?? null,
    region: body.region ?? null,
    active: body.active ?? true,
    notes: body.notes ?? null,
  };
  const { data, error } = await supabaseAdmin.from('booker_sources').insert(row).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, source: data });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
