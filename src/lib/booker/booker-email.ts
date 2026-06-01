/**
 * BLVBooker email sender. Separate identity from the clinic outbound system
 * so venue reputation never mixes with the BLVSTACK cold-outbound domain.
 *
 * Sender identity is config-driven via booker_settings (booker_from_email, booker_from_name).
 * Uses RESEND_BOOKER_API_KEY for the dedicated Resend account.
 */

import { Resend } from 'resend';
import { supabaseAdmin } from '../supabase';
import { wrapBookerEmail } from './booker-email-template';
import type { BookerSettingKey } from './types';

// Prefer dedicated booker Resend key; fall back to the cold-outbound key
// (Resend account #2 has tryblvstack.com verified, which is BLVBooker's send domain).
// Last resort = transactional key, but that account does NOT have tryblvstack.com.
const bookerKey =
  import.meta.env.RESEND_BOOKER_API_KEY ??
  import.meta.env.RESEND_OUTBOUND_API_KEY ??
  import.meta.env.RESEND_API_KEY;
const resend = new Resend(bookerKey);

// ─── Settings helpers ─────────────────────────────────────────────

export async function getBookerSetting(key: BookerSettingKey): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('booker_settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

export async function setBookerSetting(key: BookerSettingKey, value: string): Promise<void> {
  await supabaseAdmin
    .from('booker_settings')
    .upsert({ key, value }, { onConflict: 'key' });
}

export async function getAllBookerSettings(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from('booker_settings').select('*');
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  return map;
}

// ─── Send helpers ─────────────────────────────────────────────────

interface SendVenuePitchOpts {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

interface SendResult {
  messageId: string;
}

/**
 * Send a plain-text venue pitch on behalf of an artist.
 * Plain text only for cold deliverability.
 */
export async function sendVenuePitch(opts: SendVenuePitchOpts): Promise<SendResult> {
  const fromEmail = (await getBookerSetting('booker_from_email')) ?? 'booker@tryblvstack.com';
  const fromName = (await getBookerSetting('booker_from_name')) ?? 'BLVBooker';

  const bodyWithUnsub =
    opts.body + '\n\n—\nNot interested? Reply "stop" and I won\'t reach out again.';

  const result = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: opts.to,
    replyTo: opts.replyTo ?? fromEmail,
    subject: opts.subject,
    text: bodyWithUnsub,
    headers: opts.headers,
  });

  if (result.error) {
    throw new Error(result.error.message ?? 'BLVBooker venue pitch send failed');
  }

  return { messageId: result.data?.id ?? '' };
}

// ─── Artist-facing email (branded HTML — BLVBooker identity) ────

interface SendArtistEmailOpts {
  to: string;
  subject: string;
  eyebrow?: string;       // small label above title
  title: string;          // h1
  body: string;           // body text (paragraphs separated by blank lines, or raw HTML)
  cta?: { label: string; url: string };
  replyTo?: string;
}

/**
 * Send a branded HTML email to an artist on the roster.
 * Uses the BLVBooker template — distinct from BLVSTACK's branding.
 * For cold venue pitches use sendVenuePitch (plain text for deliverability).
 */
export async function sendArtistEmail(opts: SendArtistEmailOpts): Promise<SendResult> {
  const fromEmail = (await getBookerSetting('booker_from_email')) ?? 'blvbooker@tryblvstack.com';
  const fromName = (await getBookerSetting('booker_from_name')) ?? 'BLVBooker';
  const signature = (await getBookerSetting('artist_send_signature')) ?? '';

  const html = wrapBookerEmail({
    preheader: opts.body.slice(0, 120).replace(/\n/g, ' '),
    eyebrow: opts.eyebrow,
    title: opts.title,
    body: opts.body,
    cta: opts.cta,
    signoff: signature || undefined,
  });

  const result = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: opts.to,
    replyTo: opts.replyTo ?? fromEmail,
    subject: opts.subject,
    html,
  });

  if (result.error) {
    throw new Error(result.error.message ?? 'BLVBooker artist email send failed');
  }

  return { messageId: result.data?.id ?? '' };
}

export async function isBookerEmailConfigured(): Promise<boolean> {
  const fromEmail = await getBookerSetting('booker_from_email');
  return !!fromEmail && !!bookerKey;
}
