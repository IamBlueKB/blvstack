/**
 * POST /api/admin/assessments/[id] — set an assessment's pipeline status.
 * Admin-only (the middleware 401s /api/admin/* without a session).
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const STATUSES = new Set(['new', 'contacted', 'call_booked', 'won', 'lost']);

export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: 'Missing id.' }, 400);
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (!STATUSES.has(status)) return json({ error: 'Invalid status.' }, 400);
  const { data, error } = await supabaseAdmin
    .from('project_assessments')
    .update({ status, status_updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, status')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Not found.' }, 404);
  return json({ ok: true, ...data });
};

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}
