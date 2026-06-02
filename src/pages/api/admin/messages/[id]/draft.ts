import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { composeReply } from '../../../../../lib/reply-composer';

export const prerender = false;

/**
 * POST /api/admin/messages/[id]/draft
 * Composes an AI reply and saves it as draft_subject + draft_body.
 *
 * PUT /api/admin/messages/[id]/draft
 * Saves operator-edited draft.
 */
export const POST: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data: msg, error: fetchErr } = await supabaseAdmin
    .from('contact_messages')
    .select('id, name, email, message')
    .eq('id', id)
    .single();

  if (fetchErr || !msg) return j({ error: 'Message not found' }, 404);

  try {
    const { subject, body } = await composeReply({
      name: msg.name,
      email: msg.email,
      message: msg.message,
    });

    const { error: updateErr } = await supabaseAdmin
      .from('contact_messages')
      .update({ draft_subject: subject, draft_body: body })
      .eq('id', id);

    if (updateErr) return j({ error: updateErr.message }, 500);

    return j({ ok: true, subject, body });
  } catch (err: any) {
    console.error('[messages/draft] error:', err);
    return j({ error: err?.message ?? 'Draft failed' }, 500);
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: { subject?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const update: Record<string, unknown> = {};
  if (typeof body.subject === 'string') update.draft_subject = body.subject;
  if (typeof body.body === 'string') update.draft_body = body.body;

  if (Object.keys(update).length === 0) {
    return j({ error: 'Nothing to update' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('contact_messages')
    .update(update)
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
