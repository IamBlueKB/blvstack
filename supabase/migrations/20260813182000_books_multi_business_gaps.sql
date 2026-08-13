-- Closing the remaining single-business assumptions found by sweeping for them
-- (rather than hitting them one at a time):
--
--   1. clearear_recurring (recurring INVOICE templates) had no business column.
--   2. next_clearear_invoice_number existed TWICE — CREATE OR REPLACE with a new
--      parameter made an OVERLOAD, not a replacement. A legacy zero-arg call would
--      still hit the old body and stamp a CE- number on a BLVSTACK invoice. The old
--      signature is dropped so the business-aware one is the only way to get a number.
--
-- Deliberately NOT business-scoped (shared by both books, verified by the sweep):
--   clearear_contacts (a person, not a transaction), clearear_expense_categories,
--   clearear_payment_methods (shared taxonomies), clearear_services (studio catalog).

alter table clearear_recurring add column if not exists business text;
update clearear_recurring set business = 'clearear' where business is null;
alter table clearear_recurring alter column business set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clearear_recurring_business_check') then
    alter table clearear_recurring add constraint clearear_recurring_business_check
      check (business in ('clearear','blvstack'));
  end if;
end $$;

-- Drop the pre-multi-business overload. Keeps exactly one numbering entry point.
drop function if exists public.next_clearear_invoice_number();

notify pgrst, 'reload schema';
