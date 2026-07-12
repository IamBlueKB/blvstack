import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

/**
 * JANET recommendation ledger (spec §2 — accountability).
 *   GET  /api/janet/recommendations           — list, filterable by ?status &category &outcome
 *   POST /api/janet/recommendations           — Blue tags an outcome on a recommendation
 *
 * The POST is Blue's own hand (from the scorecard UI), not JANET acting — so it
 * writes the ledger directly rather than going through a Ring 2 tool. Auth:
 * founder session (middleware).
 */

const OUTCOMES = ['worked', 'failed', 'partial', 'unknown'];
const STATUSES = ['open', 'accepted', 'rejected', 'ignored', 'superseded'];
const VERDICTS = ['right', 'wrong', 'mixed'];

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let q = supabaseAdmin
    .from('janet_recommendations')
    .select('*')
    .order('made_at', { ascending: false })
    .limit(500);
  const status = url.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const category = url.searchParams.get('category');
  if (category) q = q.eq('category', category);
  const outcome = url.searchParams.get('outcome');
  if (outcome) q = q.eq('outcome', outcome);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ recommendations: data ?? [] });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return json({ error: 'id is required' }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.outcome === 'string' && OUTCOMES.includes(body.outcome)) {
    patch.outcome = body.outcome;
    patch.outcome_recorded_at = new Date().toISOString();
  }
  if (typeof body.outcome_detail === 'string') patch.outcome_detail = body.outcome_detail;
  if (typeof body.outcome_value === 'number' && isFinite(body.outcome_value)) patch.outcome_value = body.outcome_value;
  if (typeof body.status === 'string' && STATUSES.includes(body.status)) patch.status = body.status;
  if (typeof body.blue_verdict === 'string' && VERDICTS.includes(body.blue_verdict)) patch.blue_verdict = body.blue_verdict;
  if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await supabaseAdmin.from('janet_recommendations').update(patch).eq('id', id).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, recommendation: data });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
