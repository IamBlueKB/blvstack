import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

// DELETE = soft-delete (move to trash, recoverable). ?permanent=true hard-deletes.
// /api/admin/* is gated by middleware; the check below is belt-and-suspenders.
export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.adminEmail) return j({ error: 'Unauthorized' }, 401);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  if (url.searchParams.get('permanent') === 'true') {
    const { error } = await supabaseAdmin.from('janet_sent_emails').delete().eq('id', id);
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true, permanent: true });
  }

  const { error } = await supabaseAdmin
    .from('janet_sent_emails')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, trashed: true });
};

// POST ?restore=true = pull a row back out of the trash.
export const POST: APIRoute = async ({ params, url, locals }) => {
  if (!locals.adminEmail) return j({ error: 'Unauthorized' }, 401);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  if (url.searchParams.get('restore') !== 'true') return j({ error: 'Unknown action' }, 400);

  const { error } = await supabaseAdmin
    .from('janet_sent_emails')
    .update({ deleted_at: null })
    .eq('id', id);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, restored: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
