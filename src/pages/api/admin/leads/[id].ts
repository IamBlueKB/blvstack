import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const ALLOWED_STATUSES = new Set([
  'new',
  'qualified',
  'call_booked',
  'proposal_sent',
  'won',
  'lost',
  'disqualified',
]);

export const PATCH: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: { status?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const patch: Record<string, string | null> = {};
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) return j({ error: 'Invalid status' }, 400);
    patch.status = body.status;
  }
  if (body.notes !== undefined) {
    patch.notes = body.notes.trim() === '' ? null : body.notes;
  }

  if (Object.keys(patch).length === 0) return j({ error: 'Nothing to update' }, 400);

  const { error } = await supabaseAdmin.from('leads').update(patch).eq('id', id);
  if (error) return j({ error: error.message }, 500);

  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
