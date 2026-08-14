-- clearear_retainers — a monthly retainer for a client. It bills through the EXISTING
-- clearear_recurring machinery (the cron that drafts recurring invoices), NOT Stripe
-- subscriptions (deferred). Each retainer OWNS exactly one clearear_recurring row:
--
--   recurring_id is NOT NULL and UNIQUE — a second retainer physically cannot attach
--   to the same recurring row. The 1:1 is enforced by the constraint, not convention.
--
-- MRR is read from THIS table only (sum of active monthly_rate). The generated
-- invoices are the actual billing; they are never also counted as MRR — that's the
-- double-count the design avoids.

create table if not exists clearear_retainers (
  id            uuid primary key default gen_random_uuid(),
  business      text not null check (business in ('clearear','blvstack')),
  contact_id    uuid not null references clearear_contacts(id),
  monthly_rate  numeric(12,2) not null check (monthly_rate > 0),
  start_date    date not null,
  status        text not null default 'active' check (status in ('active','paused','ended')),
  end_date      date,
  recurring_id  uuid not null unique references clearear_recurring(id),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists clearear_retainers_business_idx on clearear_retainers (business);
create index if not exists clearear_retainers_contact_idx on clearear_retainers (contact_id);
-- A client can have at most ONE active retainer — stops a client being double-billed
-- by two live retainers (the "don't wire both to the same client" rule).
create unique index if not exists clearear_retainers_one_active_per_contact
  on clearear_retainers (contact_id) where status = 'active';

notify pgrst, 'reload schema';
