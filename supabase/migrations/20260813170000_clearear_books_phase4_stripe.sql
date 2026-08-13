-- Clear Ear Books Phase 4 — Stripe columns on clearear_payments.
-- Base spec 4.4: stripe_payment_intent_id (unique — dedup Stripe's at-least-once
-- webhooks), fee_amount + net_amount (gross ≠ net; fee posts as a fees expense).
-- Addendum A5: refunds are their own rows (negative amount), never edits — enable
-- refund_of_payment_id + stripe_refund_id, and relax the amount check.
alter table clearear_payments
  add column if not exists stripe_payment_intent_id text unique,
  add column if not exists fee_amount numeric(12,2),
  add column if not exists net_amount numeric(12,2),
  add column if not exists refund_of_payment_id uuid references clearear_payments(id),
  add column if not exists stripe_refund_id text unique;

-- Relax amount check so refund rows (negative) can be inserted. Existing check
-- name in this project: clearear_payments_amount_check (default).
do $$ begin
  if exists (select 1 from pg_constraint where conname='clearear_payments_amount_check') then
    alter table clearear_payments drop constraint clearear_payments_amount_check;
  end if;
  alter table clearear_payments add constraint clearear_payments_amount_check check (amount <> 0);
end $$;
