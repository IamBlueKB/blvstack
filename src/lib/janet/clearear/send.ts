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
