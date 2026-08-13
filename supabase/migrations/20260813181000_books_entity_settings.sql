-- Settings were built for one business. Splitting them deliberately rather than
-- forcing everything per-business:
--   ENTITY-LEVEL (one legal entity, one tax return) — books_closed_through, tax_id.
--     A per-business lock would let Clear Ear close while BLVSTACK stays open, and
--     the combined P&L used for filing would be half-locked.
--   PER-BUSINESS (identity/branding) — name, address, email, phone, terms, notes,
--     default_tax_rate (studio vs dev services differ), invoice prefix + sequence.
-- The entity columns are DROPPED from the per-business table so a per-business lock
-- can never be written again.

create table if not exists books_entity_settings (
  id int primary key default 1 check (id = 1),
  books_closed_through date,
  tax_id text,
  updated_at timestamptz not null default now()
);

insert into books_entity_settings (id, books_closed_through, tax_id)
select 1,
       (select books_closed_through from clearear_settings where business = 'clearear'),
       (select tax_id from clearear_settings where business = 'clearear')
on conflict (id) do nothing;

alter table clearear_settings drop column if exists books_closed_through;
alter table clearear_settings drop column if exists tax_id;

notify pgrst, 'reload schema';
