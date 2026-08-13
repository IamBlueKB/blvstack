-- Clear Ear Books — Phase 3 (tax). A7: 1099 needs to know who has a W-9 on file and
-- who's a corporation (corps are generally exempt from 1099-NEC).
alter table clearear_contacts
  add column if not exists tax_id_on_file boolean not null default false,
  add column if not exists is_corporation boolean not null default false;
