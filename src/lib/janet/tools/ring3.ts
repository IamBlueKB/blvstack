// JANET v1 — Ring 3 tools (spec §6): external / irreversible. NEVER executed
// without explicit Blue approval. The registry refuses a Ring 3 call that
// doesn't carry approvedByUser; the brain turns a Ring 3 tool call into a plan
// card, and only /api/janet/approve runs the handler (with approvedByUser=true)
// after Blue clicks Approve.
//
// v1 keeps Ring 3 minimal — just send_email over the existing Resend infra.

import { resend, FOUNDER_EMAIL, FROM_EMAIL } from '../../resend';
import { supabaseAdmin } from '../../supabase';
import { wrapEmail } from '../../email-template';
import { runSendBatch, runFollowUps } from '../../outbound/engine';
import type { JanetTool } from '../types';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}
function optString(input: unknown, key: string): string | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** JANET sends as Blue over the verified BLVSTACK domain. */
const SEND_FROM = `Blue <${FOUNDER_EMAIL}>`;

export const ring3Tools: JanetTool[] = [
  {
    name: 'send_email',
    description:
      'Send a real email to a real person over BLVSTACK email. This LEAVES the building — it always requires Blue to approve the drafted email first. Provide the full drafted content; Blue reviews and approves before it sends.',
    ring: 3,
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body, signed as Blue' },
        deal_id: { type: 'string', description: 'Optional deal to associate' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: async (input) => {
      const to = reqString(input, 'to');
      const subject = reqString(input, 'subject');
      const body = reqString(input, 'body');

      const { data, error } = await resend.emails.send({
        from: SEND_FROM,
        to,
        subject,
        replyTo: FOUNDER_EMAIL,
        text: body,
      });
      if (error) throw new Error(typeof error === 'string' ? error : (error as any).message ?? 'send failed');

      // Best-effort: note the send on the deal.
      const dealId = (input as any)?.deal_id;
      if (typeof dealId === 'string' && dealId) {
        await supabaseAdmin
          .from('janet_deals')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', dealId);
      }

      return { sent: true, id: data?.id ?? null, to, subject };
    },
  },
  {
    name: 'send_lead_reply',
    description:
      "Send a reply to an inbound lead's real inbox (by lead id). LEAVES the building — always requires Blue's approval first. Draft with draft_lead_reply, then call this with the final subject + body for Blue to approve.",
    ring: 3,
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'Lead UUID' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body, signed as Blue' },
      },
      required: ['lead_id', 'subject', 'body'],
    },
    handler: async (input) => {
      const id = reqString(input, 'lead_id');
      const subject = reqString(input, 'subject');
      const text = reqString(input, 'body');
      const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      if (!lead.email) throw new Error('Lead has no email to reply to.');
      const htmlBody = text
        .split(/\n\n+/)
        .map((para) => `<p style="margin:0 0 14px 0;">${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
        .join('');
      const { error: sendErr } = await resend.emails.send({
        from: FROM_EMAIL,
        to: lead.email,
        replyTo: 'hello@blvstack.com',
        subject,
        html: wrapEmail({
          preheader: text.slice(0, 120).replace(/\n/g, ' '),
          eyebrow: '// Reply from BLVSTΛCK',
          title: `Hey ${(lead.name ?? '').split(' ')[0] || 'there'} —`,
          body: htmlBody,
        }),
      });
      if (sendErr) throw new Error((sendErr as any).message ?? 'send failed');
      const stamp = new Date().toISOString();
      await supabaseAdmin
        .from('leads')
        .update({
          notes: `${lead.notes ?? ''}\n\n--- Reply sent ${stamp} ---\nSubject: ${subject}\n\n${text}`,
          first_response_at: lead.first_response_at ?? stamp, // speed-to-lead (spec 1.4)
        })
        .eq('id', id);
      return { sent: true, lead_id: id, to: lead.email, subject };
    },
  },
  {
    name: 'send_message_reply',
    description:
      "Send the reply to an inbound contact-form message (by message id). LEAVES the building — always requires Blue's approval. Uses the saved draft unless you pass subject/body. Marks the message replied + resolved.",
    ring: 3,
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'contact_messages UUID' },
        subject: { type: 'string', description: 'Overrides the saved draft subject' },
        body: { type: 'string', description: 'Overrides the saved draft body' },
      },
      required: ['message_id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'message_id');
      const { data: msg, error } = await supabaseAdmin
        .from('contact_messages')
        .select('id, name, email, draft_subject, draft_body, replied_at')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      if (msg.replied_at) throw new Error('Already replied to this message.');
      const subject = optString(input, 'subject') ?? msg.draft_subject;
      const body = optString(input, 'body') ?? msg.draft_body;
      if (!subject || !body) throw new Error('No draft to send — draft one first (draft_message_reply).');
      if (!msg.email) throw new Error('No recipient email on message.');
      const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.55;color:#0A1628;white-space:pre-wrap;">${body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`;
      const { data: sent, error: sendErr } = await resend.emails.send({
        from: 'Blue at BLVSTACK <hello@blvstack.com>',
        to: msg.email,
        replyTo: 'hello@blvstack.com',
        subject,
        text: body,
        html,
      });
      if (sendErr) throw new Error((sendErr as any).message ?? 'send failed');
      await supabaseAdmin
        .from('contact_messages')
        .update({
          replied_at: new Date().toISOString(),
          replied_subject: subject,
          replied_body: body,
          replied_by_email: FOUNDER_EMAIL,
          resend_message_id: sent?.id ?? null,
          status: 'resolved',
        })
        .eq('id', id);
      return { sent: true, message_id: id, to: msg.email, subject };
    },
  },
  {
    name: 'send_outbound_batch',
    description:
      'Send the next batch of queued cold-outreach emails to real prospects (SunResponse). LEAVES the building — always requires Blue approval. Returns how many were sent.',
    ring: 3,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const result = await runSendBatch();
      return { ...result };
    },
  },
  {
    name: 'process_outbound_followups',
    description:
      'Send due follow-up emails to prospects who have not replied (SunResponse cadence). LEAVES the building — always requires Blue approval. Returns how many follow-ups were sent.',
    ring: 3,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const result = await runFollowUps();
      return { ...result };
    },
  },
];
