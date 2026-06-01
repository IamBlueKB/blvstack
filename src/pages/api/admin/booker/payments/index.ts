import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

/** Payments are manager+ only. Agents cannot see money. */

export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  const status = url.searchParams.get('status');
  const period = url.searchParams.get('period');
  const artistId = url.searchParams.get('artist_id');
  let query = supabaseAdmin
    .from('booker_payments')
    .select('*, artist:booker_artists(id, name, stage_name)')
    .order('created_at', { ascending: false });
  if (status && status !== 'all') query = query.eq('status', status);
  if (period) query = query.eq('period', period);
  if (artistId) query = query.eq('artist_id', artistId);
  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ payments: data ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const required = ['artist_id', 'type', 'amount'];
  for (const r of required) if (!body[r]) return j({ error: `${r} required` }, 400);
  const row: Record<string, unknown> = {
    artist_id: body.artist_id,
    match_id: body.match_id ?? null,
    type: body.type,
    amount: body.amount,
    period: body.period ?? null,
    status: body.status ?? 'pending',
    method: body.method ?? 'manual',
    notes: body.notes ?? null,
  };
  const { data, error } = await supabaseAdmin.from('booker_payments').insert(row).select().single();
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, payment: data });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
