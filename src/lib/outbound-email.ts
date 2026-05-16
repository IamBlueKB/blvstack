/**
 * Outbound email client for BLVSTACK cold outreach.
 * Uses Resend to send from tryblvstack.com domain.
 * Replies forward via Cloudflare Email Routing → Gmail.
 */

import { supabaseAdmin } from './supabase';
import { Resend } from 'resend';

// Separate Resend account for tryblvstack.com cold outbound
const outboundKey = import.meta.env.RESEND_OUTBOUND_API_KEY ?? import.meta.env.RESEND_API_KEY;
const resend = new Resend(outboundKey);

// ─── Settings helpers ─────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('outbound_settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await supabaseAdmin
    .from('outbound_settings')
    .upsert({ key, value }, { onConflict: 'key' });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from('outbound_settings').select('*');
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  return map;
}

// ─── Send email via Resend ────────────────────────────────────────

interface SendEmailOpts {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

interface SendResult {
  messageId: string;
}

export async function sendOutboundEmail(opts: SendEmailOpts): Promise<SendResult> {
  const fromEmail = (await getSetting('outbound_from_email')) ?? 'blue@tryblvstack.com';
  const fromName = (await getSetting('outbound_from_name')) ?? 'Blue';
  const calendarLink = await getSetting('outbound_calendar_link');

  // Append calendar link (if set) + unsubscribe line
  const calendarLine = calendarLink ? `\nGrab a time if it's easier: ${calendarLink}\n` : '';
  const bodyWithUnsub = opts.body + calendarLine + '\n—\nNot interested? Reply "stop" and I won\'t reach out again.';

  const result = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: opts.to,
    replyTo: opts.replyTo ?? fromEmail,
    subject: opts.subject,
    text: bodyWithUnsub,
    headers: opts.headers,
  });

  if (result.error) {
    throw new Error(result.error.message ?? 'Resend send failed');
  }

  return { messageId: result.data?.id ?? '' };
}

// ─── Check if outbound is configured ──────────────────────────────

export async function isOutboundReady(): Promise<boolean> {
  const fromEmail = await getSetting('outbound_from_email');
  return !!fromEmail;
}
