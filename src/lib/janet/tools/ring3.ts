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
import { sendOutboundEmail, getAllSettings } from '../../outbound-email';
import { sendVerified } from '../executor';
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
      'Send a NEW/outbound email to a real person over BLVSTACK email (e.g. a fresh note, proposal follow-up, cold outreach). This LEAVES the building — it always requires Blue to approve the drafted email first. Provide the full drafted content; Blue reviews and approves before it sends. IMPORTANT — do NOT use this to REPLY to an inbound record: to reply to an inbound contact-form message use send_message_reply, and to reply to an inbound lead use send_lead_reply. Those tools keep the Messages / Leads views in sync (mark the item replied); using send_email for a reply sends the email but leaves that item looking unanswered.',
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
    handler: async (input, ctx) => {
      const to = reqString(input, 'to');
      const subject = reqString(input, 'subject');
      const body = reqString(input, 'body');

      // Best-effort: note the send on the deal, and resolve its client for the log.
      const dealId = (input as any)?.deal_id;
      let clientId: string | null = null;
      if (typeof dealId === 'string' && dealId) {
        await supabaseAdmin.from('janet_deals').update({ updated_at: new Date().toISOString() }).eq('id', dealId);
        const { data: deal } = await supabaseAdmin.from('janet_deals').select('client_id').eq('id', dealId).maybeSingle();
        clientId = deal?.client_id ?? null;
      }

      // The ONE gated send path — refuses without the /approve reference, logs + ledgers.
      const res = await sendVerified({
        actionType: 'send_email', lane: 'chat', approvalRef: ctx?.approvalRef ?? null,
        idempotencyKey: `send_email:${ctx?.approvalRef ?? 'noappr'}:${to}:${subject}`,
        message: { client: resend, from: SEND_FROM, to, replyTo: FOUNDER_EMAIL, subject, text: body },
        log: { type: 'general', source: 'chat', to, subject, body, fromEmail: FOUNDER_EMAIL, actor: 'blue', dealId: typeof dealId === 'string' && dealId ? dealId : null, clientId },
      });
      if (!res.ok) throw new Error(res.error ?? 'send failed');
      return { sent: true, id: res.id, to, subject };
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
    handler: async (input, ctx) => {
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
      const res = await sendVerified({
        actionType: 'send_lead_reply', lane: 'chat', approvalRef: ctx?.approvalRef ?? null,
        idempotencyKey: `send_lead_reply:${ctx?.approvalRef ?? 'noappr'}:${id}`,
        message: {
          client: resend, from: FROM_EMAIL, to: lead.email, replyTo: 'hello@blvstack.com', subject,
          html: wrapEmail({ preheader: text.slice(0, 120).replace(/\n/g, ' '), eyebrow: '// Reply from BLVSTΛCK', title: `Hey ${(lead.name ?? '').split(' ')[0] || 'there'} —`, body: htmlBody }),
        },
        log: { type: 'lead_reply', source: 'chat', to: lead.email, toName: lead.name ?? null, subject, body: text, fromEmail: FROM_EMAIL, actor: 'blue', leadId: id },
      });
      if (!res.ok) throw new Error(res.error ?? 'send failed');
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
    handler: async (input, ctx) => {
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
      const res = await sendVerified({
        actionType: 'send_message_reply', lane: 'chat', approvalRef: ctx?.approvalRef ?? null,
        idempotencyKey: `send_message_reply:${ctx?.approvalRef ?? 'noappr'}:${id}`,
        message: { client: resend, from: 'Blue at BLVSTACK <hello@blvstack.com>', to: msg.email, replyTo: 'hello@blvstack.com', subject, text: body, html },
        log: { type: 'contact_reply', source: 'chat', to: msg.email, toName: msg.name ?? null, subject, body, fromEmail: 'hello@blvstack.com', actor: 'blue', messageId: id },
      });
      if (!res.ok) throw new Error(res.error ?? 'send failed');
      await supabaseAdmin
        .from('contact_messages')
        .update({
          replied_at: new Date().toISOString(),
          replied_subject: subject,
          replied_body: body,
          replied_by_email: FOUNDER_EMAIL,
          resend_message_id: res.id,
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
      'Draft the due cold-outreach follow-ups into the approval queue (SunResponse cadence). Each due prospect becomes a one-click follow-up card for Blue to review; nothing sends until approved. Returns how many were queued.',
    ring: 3,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const result = await runFollowUps();
      return { ...result };
    },
  },
  {
    // Cron-internal (hidden from the model): sends ONE already-drafted follow-up
    // that the follow-up cron queued into pending-approvals. Only ever runs via
    // /api/janet/approve → the executor, never by the model calling it directly.
    name: 'send_outbound_followup',
    description:
      'Send one already-drafted cold-outreach follow-up to a prospect and advance their cadence. Runs only through the approval queue.',
    ring: 3,
    hidden: true,
    input_schema: {
      type: 'object',
      properties: {
        prospect_id: { type: 'string' },
        follow_up_number: { type: 'number' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['prospect_id', 'follow_up_number', 'subject', 'body'],
    },
    handler: async (input, ctx) => {
      const prospectId = reqString(input, 'prospect_id');
      const followUpNumber = Number((input as any).follow_up_number);
      if (!Number.isFinite(followUpNumber) || followUpNumber < 1 || followUpNumber > 3) {
        throw new Error('follow_up_number must be 1–3');
      }
      const subject = reqString(input, 'subject');
      const body = reqString(input, 'body');

      const { data: prospect, error } = await supabaseAdmin.from('prospects').select('*').eq('id', prospectId).single();
      if (error) throw new Error(error.message);
      if (!prospect.contact_email) throw new Error('Prospect has no email to follow up.');

      const result = await sendOutboundEmail({
        to: prospect.contact_email,
        subject,
        body,
        headers: { 'X-Prospect-Id': prospectId },
        approvalRef: ctx?.approvalRef ?? null,
        idempotencyKey: `outbound_followup:${prospectId}:${followUpNumber}`,
      });

      // Advance the cadence — mirrors what the old auto-send runFollowUps did inline.
      const typeMap: Record<number, string> = { 1: 'follow_up_1', 2: 'follow_up_2', 3: 'follow_up_3' };
      await supabaseAdmin.from('outbound_emails').insert({
        prospect_id: prospectId,
        type: typeMap[followUpNumber] ?? 'follow_up_3',
        subject,
        body,
        gmail_message_id: result.messageId,
        status: 'sent',
      });

      const settings = await getAllSettings();
      const followUpDays = (settings.follow_up_days ?? '4,10,21').split(',').map(Number);
      const updates: Record<string, unknown> = {
        status: followUpNumber >= 3 ? 'dead' : (typeMap[followUpNumber] ?? 'follow_up_3'),
        follow_up_count: followUpNumber,
        last_sent_at: new Date().toISOString(),
        gmail_message_id: result.messageId,
      };
      if (followUpNumber < 3 && followUpDays[followUpNumber]) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + followUpDays[followUpNumber]);
        updates.next_follow_up_at = nextDate.toISOString();
      } else {
        updates.next_follow_up_at = null;
      }
      await supabaseAdmin.from('prospects').update(updates).eq('id', prospectId);

      return { sent: true, prospect_id: prospectId, follow_up_number: followUpNumber, to: prospect.contact_email };
    },
  },
];
