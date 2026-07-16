-- Session-level view attribution for published pages.
--  1. Per-recipient tokened links: blvstack.com/[slug]?v=<token> → a view on that
--     token attributes to a specific lead/client.
--  2. Views gain: viewer_type (anonymous/recipient/owner), the recipient link,
--     the token, a session id (first-party cookie → groups repeat visits from one
--     browser), and IP. Owner = authenticated admin proofing — never a client view.
-- Visitor IP/device is PII: BOTH tables are RLS-locked (service-role only).

create table if not exists janet_page_recipient_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references janet_published_pages(id) on delete cascade,
  token text not null unique,
  recipient_name text,
  lead_id uuid references leads(id) on delete set null,
  client_id uuid references janet_clients(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists janet_page_recipient_links_page_idx on janet_page_recipient_links (page_id);
create index if not exists janet_page_recipient_links_token_idx on janet_page_recipient_links (token);
alter table janet_page_recipient_links enable row level security;
-- no policies → service role only

alter table janet_page_views
  add column if not exists viewer_type text not null default 'anonymous',  -- 'anonymous' | 'recipient' | 'owner'
  add column if not exists recipient_link_id uuid references janet_page_recipient_links(id) on delete set null,
  add column if not exists token text,
  add column if not exists session_id text,
  add column if not exists ip text;

create index if not exists janet_page_views_session_idx on janet_page_views (page_id, session_id);
create index if not exists janet_page_views_recipient_idx on janet_page_views (recipient_link_id);

-- Lock down view PII (was open). Service role (supabaseAdmin) bypasses RLS; the
-- public view-ingest already writes via the service role, so nothing breaks.
alter table janet_page_views enable row level security;
-- no policies → not publicly readable

notify pgrst, 'reload schema';
