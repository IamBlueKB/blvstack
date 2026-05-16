import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { resend, FROM_EMAIL } from '../../../../../lib/resend';
import { wrapEmail } from '../../../../../lib/email-template';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  let body: { subject?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  if (!body.subject || !body.text) return j({ error: 'Missing subject or text' }, 400);

  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).single();
  if (!lead) return j({ error: 'Lead not found' }, 404);

  // Convert plain text to <p> paragraphs for HTML body
  const htmlBody = body.text
    .split(/\n\n+/)
    .map((para) => `<p style="margin:0 0 14px 0;">${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: lead.email,
      replyTo: 'hello@blvstack.com',
      subject: body.subject,
      html: wrapEmail({
        preheader: body.text.slice(0, 120).replace(/\n/g, ' '),
        eyebrow: '// Reply from BLVSTΛCK',
        title: `Hey ${(lead.name ?? '').split(' ')[0] || 'there'} —`,
        body: htmlBody,
      }),
    });
  } catch (err: any) {
    console.error('[send-reply] resend error', err);
    return j({ error: 'Send failed', detail: err?.message ?? 'unknown' }, 500);
  }

  // Append to notes for record
  const stamp = new Date().toISOString();
  const prevNotes = lead.notes ?? '';
  const sentRecord = `\n\n--- Reply sent ${stamp} ---\nSubject: ${body.subject}\n\n${body.text}`;
  await supabaseAdmin.from('leads').update({ notes: prevNotes + sentRecord }).eq('id', id);

  return j({ ok: true });
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
