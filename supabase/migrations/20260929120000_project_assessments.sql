-- Free project assessment (blvstack.com/assessment). A short questionnaire that
-- returns a high-level brief on screen and by email. Every submission ALSO creates
-- a normal `leads` row (source 'assessment') — one lead pipeline: JANET triages it,
-- briefs it in the morning, and drafts follow-ups that only send on approval.
--
-- email_status records the outcome of the brief email, which is sent after the
-- response (waitUntil): a failed send is recorded as 'failed' with its error, never
-- swallowed.

create table if not exists public.project_assessments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid references public.leads(id) on delete set null,

  name text not null,
  email text not null,
  phone text,
  need text not null check (need in ('new', 'refresh', 'unsure')),
  current_site text,
  goals text[] not null default '{}',
  about text,
  timeline text not null check (timeline in ('month', 'quarter', 'later', 'exploring')),

  approach text not null check (approach in ('focused', 'capture_booking', 'managed')),
  brief jsonb not null,
  brief_source text not null check (brief_source in ('model', 'template')),

  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_id text,
  email_sent_at timestamptz,
  email_error text,

  status text not null default 'new' check (status in ('new', 'contacted', 'call_booked', 'won', 'lost')),
  status_updated_at timestamptz,
  ip_address text
);

create index if not exists project_assessments_created_idx on public.project_assessments (created_at desc);

-- Server-only table (service role). No public policies.
alter table public.project_assessments enable row level security;

notify pgrst, 'reload schema';
