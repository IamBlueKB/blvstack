-- JANET fillable forms — a published doc with field blocks is a questionnaire;
-- client submissions land here as first-class records tied to the client.
-- PII: RLS ENABLED with NO policies → anon/authenticated get nothing via the
-- REST API; only the service role (supabaseAdmin, server-side) can read/write.

create table if not exists janet_form_responses (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references janet_published_pages(id) on delete cascade,
  doc_id uuid references janet_docs(id) on delete set null,
  client_id uuid references janet_clients(id),
  answers jsonb not null default '{}'::jsonb,
  respondent_name text,
  respondent_email text,
  referrer text,
  user_agent text,
  submitted_at timestamptz not null default now()
);
create index if not exists janet_form_responses_doc_idx on janet_form_responses (doc_id, submitted_at desc);
create index if not exists janet_form_responses_client_idx on janet_form_responses (client_id, submitted_at desc);

alter table janet_form_responses enable row level security;
-- No policies on purpose: RLS-on + no-policy blocks anon/authenticated entirely;
-- the service role bypasses RLS, so the app (supabaseAdmin) still works.
