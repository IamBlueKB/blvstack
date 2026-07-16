-- Sent-mail log v2: soft-delete/trash, source tagging (chat/batch/cron),
-- delivery status (updated by the Resend webhook), from-address + actor.

alter table janet_sent_emails
  add column if not exists deleted_at timestamptz,
  add column if not exists source text not null default 'chat',   -- 'chat' | 'batch' | 'cron'
  add column if not exists status text not null default 'sent',   -- 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed'
  add column if not exists status_at timestamptz,
  add column if not exists from_email text,
  add column if not exists actor text;                            -- who/what sent it: 'blue', 'outbound-engine', 'blvbooker', 'staff:<email>'

create index if not exists janet_sent_emails_deleted_at_idx on janet_sent_emails (deleted_at);
create index if not exists janet_sent_emails_resend_id_idx on janet_sent_emails (resend_id);
create index if not exists janet_sent_emails_source_idx on janet_sent_emails (source);

notify pgrst, 'reload schema';
