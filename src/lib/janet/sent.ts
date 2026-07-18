// JANET sent-mail log. Every outbound email is recorded here AFTER it executes,
// so /admin/sent is a real record of what went out — across chat sends, the
// cold-outreach batch engine, and BLVBooker automation. Recipient addresses +
// bodies are PII: the table is RLS-locked (service-role only). Delivery status
// is updated by the Resend webhook (/api/webhooks/resend). Soft-delete → trash.
// Migrations: 20260716120000_janet_sent_emails.sql (+ _v2).

import { supabaseAdmin } from '../supabase';

export type SentEmailType = 'general' | 'lead_reply' | 'contact_reply';
export type SentSource = 'chat' | 'batch' | 'cron' | 'manual';
export type SentStatus = 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed';

export interface RecordSentEmailInput {
  type: SentEmailType;
  source?: SentSource; // default 'chat'
  to: string;
  toName?: string | null;
  fromEmail?: string | null;
  actor?: string | null;
  subject: string;
  body: string;
  clientId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  messageId?: string | null;
  resendId?: string | null;
}

/** Log an outbound email AFTER it actually sent. Best-effort — a logging failure
 *  must NEVER fail the send (the email already left the building). Returns the
 *  inserted row id (or null) so the action ledger can link to it. */
export async function recordSentEmail(input: RecordSentEmailInput): Promise<{ id: string } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('janet_sent_emails')
      .insert({
        type: input.type,
        source: input.source ?? 'chat',
        to_email: input.to,
        to_name: input.toName ?? null,
        from_email: input.fromEmail ?? null,
        actor: input.actor ?? null,
        subject: input.subject,
        body: input.body,
        client_id: input.clientId ?? null,
        deal_id: input.dealId ?? null,
        lead_id: input.leadId ?? null,
        message_id: input.messageId ?? null,
        resend_id: input.resendId ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[janet] sent-email log failed:', error.message);
      return null;
    }
    return data as { id: string };
  } catch (e) {
    console.error('[janet] sent-email log threw:', (e as Error).message);
    return null;
  }
}

// Nested rows come back from the embedded selects (FK → parent). Many-to-one, so
// each is a single object or null.
interface NamedRef { name: string | null }
export interface SentEmailRow {
  id: string;
  sent_at: string;
  type: SentEmailType;
  source: SentSource;
  status: SentStatus;
  status_at: string | null;
  to_email: string;
  to_name: string | null;
  from_email: string | null;
  actor: string | null;
  subject: string;
  body: string;
  resend_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  message_id: string | null;
  // Joined display names (null when no link or the record is gone).
  client_name: string | null;
  deal_name: string | null;
  lead_name: string | null;
  message_name: string | null;
}

const SELECT_WITH_NAMES =
  'id, sent_at, type, source, status, status_at, to_email, to_name, from_email, actor, subject, body, resend_id, client_id, deal_id, lead_id, message_id, ' +
  'client:janet_clients(name), deal:janet_deals(name), lead:leads(name), message:contact_messages(name)';

function flatten(row: any): SentEmailRow {
  const one = (r: NamedRef | NamedRef[] | null | undefined): string | null =>
    (Array.isArray(r) ? r[0]?.name : r?.name) ?? null;
  return {
    id: row.id, sent_at: row.sent_at, type: row.type, source: row.source, status: row.status, status_at: row.status_at,
    to_email: row.to_email, to_name: row.to_name, from_email: row.from_email, actor: row.actor,
    subject: row.subject, body: row.body, resend_id: row.resend_id,
    client_id: row.client_id, deal_id: row.deal_id, lead_id: row.lead_id, message_id: row.message_id,
    client_name: one(row.client), deal_name: one(row.deal), lead_name: one(row.lead), message_name: one(row.message),
  };
}

export interface ListSentOpts {
  type?: string | null;
  source?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
  trashed?: boolean; // true → only trashed rows (for the Trash view)
}

/** Sanitize a search term to plain word chars before it reaches the PostgREST
 *  or() filter (prevents filter-grammar injection from the query string). */
function safeQ(q: string | null | undefined): string {
  return (q ?? '').replace(/[^\w@.\-\s]/g, ' ').trim().slice(0, 100);
}

/** List sent emails, newest first, with total count for pagination. Excludes
 *  trashed rows unless opts.trashed. Filters by type / source / text search. */
export async function listSentEmails(opts: ListSentOpts = {}): Promise<{ rows: SentEmailRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('janet_sent_emails')
    .select(SELECT_WITH_NAMES, { count: 'exact' });

  query = opts.trashed ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
  query = opts.trashed
    ? query.order('deleted_at', { ascending: false })
    : query.order('sent_at', { ascending: false });

  if (opts.type && opts.type !== 'all') query = query.eq('type', opts.type);
  if (opts.source && opts.source !== 'all') query = query.eq('source', opts.source);
  const q = safeQ(opts.q);
  if (q) query = query.or(`to_email.ilike.%${q}%,to_name.ilike.%${q}%,subject.ilike.%${q}%,body.ilike.%${q}%`);

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error('[janet] listSentEmails failed:', error.message);
    return { rows: [], total: 0 };
  }
  return { rows: (data ?? []).map(flatten), total: count ?? 0 };
}

/** All matching rows (no pagination) for CSV export. Capped to a sane ceiling. */
export async function listSentForExport(opts: Omit<ListSentOpts, 'page' | 'pageSize' | 'trashed'> = {}): Promise<SentEmailRow[]> {
  let query = supabaseAdmin
    .from('janet_sent_emails')
    .select(SELECT_WITH_NAMES)
    .is('deleted_at', null)
    .order('sent_at', { ascending: false })
    .limit(5000);
  if (opts.type && opts.type !== 'all') query = query.eq('type', opts.type);
  if (opts.source && opts.source !== 'all') query = query.eq('source', opts.source);
  const q = safeQ(opts.q);
  if (q) query = query.or(`to_email.ilike.%${q}%,to_name.ilike.%${q}%,subject.ilike.%${q}%,body.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) { console.error('[janet] listSentForExport failed:', error.message); return []; }
  return (data ?? []).map(flatten);
}

// ─── Delivery status (Resend webhook) ──────────────────────────────────────

/** Update a row's delivery status by its Resend message id. Returns whether a
 *  row matched (a webhook for an email we didn't log is a no-op). */
export async function updateSentStatusByResendId(resendId: string, status: SentStatus): Promise<boolean> {
  if (!resendId) return false;
  const { data, error } = await supabaseAdmin
    .from('janet_sent_emails')
    .update({ status, status_at: new Date().toISOString() })
    .eq('resend_id', resendId)
    .select('id');
  if (error) { console.error('[janet] status update failed:', error.message); return false; }
  return (data?.length ?? 0) > 0;
}
