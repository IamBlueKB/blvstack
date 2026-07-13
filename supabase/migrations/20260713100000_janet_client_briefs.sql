-- JANET v2 Phase 4D — stored per-client weekly intelligence briefs (BLVSTACK-side).
-- The recurring retainer deliverable. Content is the composed brief (sections +
-- opportunities); each opportunity is also logged to janet_recommendations so the
-- ledger (the sales asset) tracks outcome → dollar impact.

create table if not exists janet_client_briefs (
  id uuid primary key default gen_random_uuid(),
  client_key text not null default 'psrx',
  week_of date not null,
  content jsonb not null,
  cost_usd numeric,
  created_at timestamptz not null default now()
);
create index if not exists janet_client_briefs_idx on janet_client_briefs (client_key, created_at desc);
