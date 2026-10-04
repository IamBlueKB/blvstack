-- Client logins vault: the third-party accounts behind each client's site (Resend, Gmail, GoDaddy, Vercel, …).
--
-- Secrets — password, API key/token, recovery codes — are AES-256-GCM encrypted by the app (VAULT_KEY, src/lib/vault.ts)
-- before they reach this table, so the database never holds them in the clear. RLS is on with NO policies: only the
-- service role (the admin server) can read. JANET has no tool that touches these tables. Every reveal is logged.

create table if not exists public.client_logins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.janet_clients(id) on delete cascade,
  site_id uuid references public.janet_sites(id) on delete set null,
  service text not null,
  login_url text,
  username text,
  password_enc text,
  api_key_enc text,
  secret_notes_enc text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists client_logins_client_idx on public.client_logins (client_id);
alter table public.client_logins enable row level security;
revoke all on public.client_logins from anon, authenticated;

-- Who added, changed, revealed or deleted a login, and when.
create table if not exists public.client_login_events (
  id bigint generated always as identity primary key,
  login_id uuid,
  client_id uuid,
  action text not null check (action in ('create', 'update', 'reveal', 'delete')),
  field text,
  service text,
  actor text,
  at timestamptz not null default now()
);
create index if not exists client_login_events_login_idx on public.client_login_events (login_id);
alter table public.client_login_events enable row level security;
revoke all on public.client_login_events from anon, authenticated;
