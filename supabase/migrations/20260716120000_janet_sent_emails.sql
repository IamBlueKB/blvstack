-- JANET sent-mail log — a real record of every outbound email she sends via
-- chat (send_email / send_lead_reply / send_message_reply), written AFTER the
-- send executes (post-approval), so it reflects what actually went out.
-- PII: RLS ENABLED with NO policies → anon/authenticated get nothing via the
-- REST API; only the service role (supabaseAdmin, server-side) reads/writes.

create table if not exists janet_sent_emails (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  type text not null,                    -- 'general' | 'lead_reply' | 'contact_reply'
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  -- Context links (set where the send has a parent). on delete set null so the
  -- historical email survives even if the related record is later removed.
  client_id uuid references janet_clients(id) on delete set null,
  deal_id uuid references janet_deals(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  message_id uuid references contact_messages(id) on delete set null,
  resend_id text,                        -- provider message id (Resend)
  created_at timestamptz not null default now()
);

create index if not exists janet_sent_emails_sent_at_idx on janet_sent_emails (sent_at desc);
create index if not exists janet_sent_emails_type_idx on janet_sent_emails (type);

alter table janet_sent_emails enable row level security;
-- Intentionally NO policies — service role only.

notify pgrst, 'reload schema';
