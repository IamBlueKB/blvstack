import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

/** GET — single prospect */
export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data, error } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return j({ error: 'Prospect not found' }, 404);
  return j({ prospect: data });
};

/** PUT — update prospect fields */
export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  // Only allow updating specific fields
  const allowed = [
    'status', 'contact_name', 'contact_email', 'company_name',
    'company_url', 'notes', 'draft_subject', 'draft_email', 'approved',
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return j({ error: 'No valid fields to update' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('prospects')
    .update(update)
    .eq('id', id);

  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

/** DELETE — remove prospect */
export const DELETE: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { error } = await supabaseAdmin
    .from('prospects')
    .delete()
    .eq('id', id);

  if (error) return j({ error: error.message }, 500);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
