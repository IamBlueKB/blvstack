-- clearear_projects — a unit of work that one or more invoices roll up to (e.g. a
-- website build billed as a deposit invoice + a balance invoice). Most Clear Ear
-- invoices won't have one; BLVSTACK agency work usually will.
--
-- business is NOT NULL with no default (new table, nothing to backfill). Named
-- clearear_* for consistency with the rest of the money layer — the eventual
-- rename to books_* is one atomic item in KNOWN_DEBT.md, not a second convention.

create table if not exists clearear_projects (
  id           uuid primary key default gen_random_uuid(),
  business     text not null check (business in ('clearear','blvstack')),
  contact_id   uuid not null references clearear_contacts(id),
  name         text not null,
  total_value  numeric(12,2),                    -- contract/quote value; pipeline, NOT revenue
  status       text not null default 'active'
                 check (status in ('proposed','active','on_hold','completed','cancelled')),
  start_date   date,
  target_date  date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists clearear_projects_business_idx on clearear_projects (business);
create index if not exists clearear_projects_contact_idx on clearear_projects (contact_id);

-- Invoices optionally belong to a project. Nullable — a standalone invoice has none.
-- A project's business must match the invoice's; enforced in app on assignment.
alter table clearear_invoices add column if not exists project_id uuid references clearear_projects(id);
create index if not exists clearear_invoices_project_idx on clearear_invoices (project_id);

notify pgrst, 'reload schema';
