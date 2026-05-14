import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const ALLOWED_STATUSES = new Set(['new', 'resolved']);

export const PATCH: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  if (!body.status || !ALLOWED_STATUSES.has(body.status)) {
    return j({ error: 'Invalid status' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('contact_messages')
    .update({ status: body.status })
    .eq('id', id);

  if (error) return j({ error: error.message }, 500);

  return j({ ok: true });
};

// DELETE = soft delete. Pass ?permanent=true to hard-delete.
export const DELETE: APIRoute = async ({ params, url }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const permanent = url.searchParams.get('permanent') === 'true';

  if (permanent) {
    const { error } = await supabaseAdmin.from('contact_messages').delete().eq('id', id);
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true, permanent: true });
  }

  const { error } = await supabaseAdmin
    .from('contact_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, trashed: true });
};

export const POST: APIRoute = async ({ params, url }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  if (url.searchParams.get('restore') !== 'true') return j({ error: 'Unknown action' }, 400);

  const { error } = await supabaseAdmin
    .from('contact_messages')
    .update({ deleted_at: null })
    .eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, restored: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
