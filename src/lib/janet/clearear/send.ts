// Clear Ear Studios - sending an invoice. One helper for both the manual editor
// button (Blue clicks = approval) and JANET's Ring-3 send_clearear_invoice tool.
// Everything routes through the ONE gated send executor with an approval ref;
// nothing sends unapproved. On success the invoice moves draft -> sent.

import { supabaseAdmin } from '../../supabase';
import { resend } from '../../resend';
import { sendVerified } from '../executor';
import { getInvoice, ensureViewToken, usd } from './invoicing';

const BASE = (import.meta as any).env?.PUBLIC_SITE_URL || 'https://blvstack.com';

export type SendInvoiceArgs = {
  invoiceId: string;
  approvalRef: string | null; // executor REFUSES without it
  actor: string; // 'blue' | admin email | 'janet'
  note?: string | null; // optional extra line from Blue/JANET
};

export async function sendInvoiceEmail(args: SendInvoiceArgs) {
  const data = await getInvoice(args.invoiceId);
  if (!data) throw new Error('Invoice not found.');
  const { invoice, contact } = data as any;
  if (invoice.status === 'void') throw new Error('This invoice is void.');
  if (invoice.status === 'paid') throw new Error('This invoice is already paid.');
  if (!contact?.email) throw new Error(`No email on ${contact?.name ?? 'the contact'} — add one before sending.`);

  const { data: settings } = await supabaseAdmin.from('clearear_settings').select('business_name, email').eq('id', 1).maybeSingle();
  const businessName = settings?.business_name || 'Clear Ear Studios';
  const token = await ensureViewToken(args.invoiceId);
  const link = `${BASE}/invoice/${token}`;
  const firstName = String(contact.name || '').trim().split(/\s+/)[0] || 'there';
  const due = Number(invoice.balance) > 0 ? Number(invoice.balance) : Number(invoice.total);

  const subject = `Invoice ${invoice.invoice_number} from ${businessName}`;
  const bodyLines = [
    `Hi ${firstName},`,
    '',
    `Here's your invoice (${invoice.invoice_number})${invoice.due_date ? `, due ${invoice.due_date}` : ''} — ${usd(due)}.`,
    ...(args.note ? ['', args.note] : []),
    '',
    `View and download it here:`,
    link,
    '',
    `Thank you,`,
    businessName,
  ];
  const text = bodyLines.join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#161616;">
    <p>Hi ${esc(firstName)},</p>
    <p>Here's your invoice (<strong>${esc(invoice.invoice_number)}</strong>)${invoice.due_date ? `, due ${esc(invoice.due_date)}` : ''} &mdash; <strong>${esc(usd(due))}</strong>.</p>
    ${args.note ? `<p>${esc(args.note)}</p>` : ''}
    <p><a href="${link}" style="display:inline-block;background:#161616;color:#fff;text-decoration:none;padding:11px 20px;border-radius:2px;font-size:13px;letter-spacing:.02em;">View invoice</a></p>
    <p style="color:#8a8a8a;font-size:12px;">Or open: ${link}</p>
    <p style="margin-top:22px;">Thank you,<br>${esc(businessName)}</p>
  </div>`;

  const from = `${businessName} <hello@blvstack.com>`;
  const replyTo = settings?.email || 'hello@blvstack.com';

  const res = await sendVerified({
    actionType: 'send_clearear_invoice',
    lane: 'manual',
    approvalRef: args.approvalRef,
    idempotencyKey: `clearear_invoice_send:${args.invoiceId}`,
    message: { client: resend, from, to: contact.email, replyTo, subject, text, html },
    log: { type: 'general', source: args.actor === 'janet' ? 'chat' : 'manual', to: contact.email, toName: contact.name ?? null, fromEmail: replyTo, actor: args.actor, subject, body: text, messageId: args.invoiceId },
  });
  if (!res.ok) throw new Error(res.error ?? 'Send failed.');

  await supabaseAdmin.from('clearear_invoices').update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', args.invoiceId);
  return { sent: true, to: contact.email, invoice_number: invoice.invoice_number, link, message_id: res.id };
}

/** Send a Clear Ear message to a contact (overdue reminder or lapsed check-in) —
 *  the drafted body, from the studio's name, with the invoice link appended when
 *  invoiceId is given. Ring-3, through the gated executor. Does not change invoice
 *  status (a reminder leaves it overdue until paid). */
export async function sendClearearMessage(args: { contactId: string; subject: string; body: string; invoiceId?: string | null; approvalRef: string | null; actor: string }) {
  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name, email').eq('id', args.contactId).maybeSingle();
  if (!contact) throw new Error('Contact not found.');
  if (!contact.email) throw new Error(`No email on ${contact.name} — add one first.`);
  const { data: settings } = await supabaseAdmin.from('clearear_settings').select('business_name, email').eq('id', 1).maybeSingle();
  const businessName = settings?.business_name || 'Clear Ear Studios';

  let text = String(args.body || '').trim();
  let linkHtml = '';
  let dedupTag = 'msg';
  if (args.invoiceId) {
    const { data: inv } = await supabaseAdmin.from('clearear_invoices').select('invoice_number, balance').eq('id', args.invoiceId).maybeSingle();
    if (inv) {
      const token = await ensureViewToken(args.invoiceId);
      const link = `${BASE}/invoice/${token}`;
      text += `\n\nBalance due: ${usd(Number(inv.balance) || 0)}\nView & pay: ${link}`;
      linkHtml = `<p style="margin-top:16px;"><a href="${link}" style="display:inline-block;background:#161616;color:#fff;text-decoration:none;padding:11px 20px;border-radius:2px;font-size:13px;">View &amp; pay invoice ${inv.invoice_number}</a></p><p style="color:#8a8a8a;font-size:12px;">Balance due: ${usd(Number(inv.balance) || 0)}</p>`;
      dedupTag = `inv:${args.invoiceId}`;
    }
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#161616;white-space:pre-wrap;">${esc(String(args.body || '').trim())}</div>${linkHtml}`;

  const res = await sendVerified({
    actionType: 'send_clearear_message',
    lane: 'manual',
    approvalRef: args.approvalRef,
    idempotencyKey: `clearear_msg:${args.contactId}:${dedupTag}:${new Date().toISOString().slice(0, 10)}`,
    message: { client: resend, from: `${businessName} <hello@blvstack.com>`, to: contact.email, replyTo: settings?.email || 'hello@blvstack.com', subject: args.subject, text, html },
    log: { type: 'general', source: args.actor === 'janet' ? 'chat' : 'manual', to: contact.email, toName: contact.name ?? null, fromEmail: settings?.email || 'hello@blvstack.com', actor: args.actor, subject: args.subject, body: text, messageId: args.contactId },
  });
  if (!res.ok) throw new Error(res.error ?? 'Send failed.');
  return { sent: true, to: contact.email, message_id: res.id };
}
