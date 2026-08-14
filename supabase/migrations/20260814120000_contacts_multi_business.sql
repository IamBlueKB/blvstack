-- Contacts go multi-business. Same pattern as the money tables: business is
-- NOT NULL with NO default; existing rows backfill to 'clearear'. This deliberately
-- OVERRIDES the earlier "contacts are shared" decision — BLVSTACK now has its own
-- billing contacts, invisible to Clear Ear and vice versa.
--
-- contact_id on invoices keeps its single FK to clearear_contacts (nothing
-- polymorphic) — a BLVSTACK invoice bills a clearear_contacts row whose business
-- is 'blvstack'. Isolation is enforced in app code (a contact can only be picked
-- for an invoice in its own business); the FK just guarantees the contact exists.

alter table clearear_contacts add column if not exists business text;
update clearear_contacts set business = 'clearear' where business is null;
alter table clearear_contacts alter column business set not null;
alter table clearear_contacts alter column business drop default;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clearear_contacts_business_check') then
    alter table clearear_contacts add constraint clearear_contacts_business_check
      check (business in ('clearear','blvstack'));
  end if;
end $$;
create index if not exists clearear_contacts_business_idx on clearear_contacts (business);

-- One-time snapshot of the 6 janet_clients as BLVSTACK billing contacts. These are
-- INDEPENDENT of janet_clients from here on — a detail change must be made in both
-- (logged in KNOWN_DEBT.md). Guarded so a re-run never double-copies.
insert into clearear_contacts (business, kind, name, contact_person, email, phone, status, notes)
select 'blvstack', 'organization', jc.name, jc.contact_name, jc.contact_email, jc.contact_phone, 'active', jc.notes
from janet_clients jc
where not exists (select 1 from clearear_contacts where business = 'blvstack');

notify pgrst, 'reload schema';
