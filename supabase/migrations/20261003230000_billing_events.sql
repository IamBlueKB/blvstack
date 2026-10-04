-- Billing activity per client plan — what shows on their account and what Blue gets emailed about:
-- signed up for automatic payments, each payment, each declined charge, card updated, site paused / restored,
-- plan paused / resumed / ended. One row per real-world event (ref makes webhook retries idempotent).

create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  retainer_id uuid references public.clearear_retainers(id) on delete cascade,
  site_id uuid references public.janet_sites(id) on delete set null,
  contact_id uuid,
  kind text not null check (kind in ('signed_up', 'charge_paid', 'charge_failed', 'card_updated', 'site_paused', 'site_restored', 'plan_paused', 'plan_resumed', 'plan_ended')),
  detail text,
  amount numeric(12,2),
  ref text,
  at timestamptz not null default now()
);
create unique index if not exists billing_events_kind_ref_key on public.billing_events (kind, ref) where ref is not null;
create index if not exists billing_events_retainer_idx on public.billing_events (retainer_id, at desc);
create index if not exists billing_events_site_idx on public.billing_events (site_id, at desc) where site_id is not null;
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
