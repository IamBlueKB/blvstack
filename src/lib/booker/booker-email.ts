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
import { recordSentEmail } from '../janet/sent';
import type { BookerSettingKey } from './types';

// Prefer the dedicated booker Resend key; fall back to the cold-outbound key —
// BOTH live on the Resend account that has tryblvstack.com verified (BLVBooker's
// send domain). There is deliberately NO fallback to the transactional key
// (RESEND_API_KEY): that account is blvstack.com and CANNOT send as
// blvbooker@tryblvstack.com — it would silently misroute. If neither key is set,
// fail loud (assertBookerKey) rather than construct a client that can't send.
const bookerKey = import.meta.env.RESEND_BOOKER_API_KEY ?? import.meta.env.RESEND_OUTBOUND_API_KEY;
const resend = new Resend(bookerKey);

function assertBookerKey(): void {
  if (!bookerKey) {
    throw new Error(
      'BLVBooker email is not configured: set RESEND_BOOKER_API_KEY or RESEND_OUTBOUND_API_KEY ' +
        '(the Resend account with tryblvstack.com verified). Refusing to send from an unverified account.'
    );
  }
}

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
  assertBookerKey();
  const fromEmail = (await getBookerSetting('booker_from_email')) ?? 'blvbooker@tryblvstack.com';
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

  await recordSentEmail({
    type: 'general', source: 'cron', to: opts.to, subject: opts.subject, body: bodyWithUnsub,
    fromEmail, actor: 'blvbooker', resendId: result.data?.id ?? null,
  });

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
  assertBookerKey();
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

  await recordSentEmail({
    type: 'general', source: 'cron', to: opts.to, subject: opts.subject, body: opts.body,
    fromEmail, actor: 'blvbooker', resendId: result.data?.id ?? null,
  });

  return { messageId: result.data?.id ?? '' };
}

export async function isBookerEmailConfigured(): Promise<boolean> {
  const fromEmail = await getBookerSetting('booker_from_email');
  return !!fromEmail && !!bookerKey;
}
