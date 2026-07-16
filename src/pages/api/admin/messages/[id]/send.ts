import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { resend } from '../../../../../lib/resend';
import { recordSentEmail } from '../../../../../lib/janet/sent';

export const prerender = false;

const FROM = 'Blue at BLVSTACK <hello@blvstack.com>';
const REPLY_TO = 'hello@blvstack.com';

/**
 * POST /api/admin/messages/[id]/send
 * Sends the draft reply via Resend. Marks the message as replied + resolved.
 * Body: { subject?: string, body?: string } — overrides the saved draft if provided.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let override: { subject?: string; body?: string } = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      override = await request.json();
    }
  } catch {
    // ignore — fall back to saved draft
  }

  const { data: msg, error: fetchErr } = await supabaseAdmin
    .from('contact_messages')
    .select('id, name, email, message, draft_subject, draft_body, replied_at')
    .eq('id', id)
    .single();

  if (fetchErr || !msg) return j({ error: 'Message not found' }, 404);
  if (msg.replied_at) return j({ error: 'Already replied' }, 409);

  const subject = override.subject ?? msg.draft_subject;
  const body = override.body ?? msg.draft_body;

  if (!subject || !body) {
    return j({ error: 'No draft to send. Click "AI draft" first or write one.' }, 400);
  }
  if (!msg.email) return j({ error: 'No recipient email on message' }, 400);

  // Plain-text email; convert line breaks to <br> for HTML version.
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.55;color:#0A1628;white-space:pre-wrap;">${body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</div>`;

  try {
    const { data: sent, error: sendErr } = await resend.emails.send({
      from: FROM,
      to: msg.email,
      replyTo: REPLY_TO,
      subject,
      text: body,
      html,
    });

    if (sendErr) {
      console.error('[messages/send] resend error:', sendErr);
      return j({ error: sendErr.message ?? 'Send failed' }, 500);
    }

    const adminEmail = (locals as any)?.adminEmail ?? null;

    await supabaseAdmin
      .from('contact_messages')
      .update({
        replied_at: new Date().toISOString(),
        replied_subject: subject,
        replied_body: body,
        replied_by_email: adminEmail,
        resend_message_id: sent?.id ?? null,
        status: 'resolved',
      })
      .eq('id', id);

    // Record in the sent-mail log (manual admin-tab reply).
    await recordSentEmail({
      type: 'contact_reply', source: 'manual', to: msg.email, toName: msg.name ?? null,
      fromEmail: REPLY_TO, actor: adminEmail ?? 'admin', subject, body,
      messageId: id, resendId: sent?.id ?? null,
    });

    return j({ ok: true, message_id: sent?.id });
  } catch (err: any) {
    console.error('[messages/send] error:', err);
    return j({ error: err?.message ?? 'Send failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
