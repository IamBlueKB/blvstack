-- BLV Books: a retainer can bill by AUTOMATIC CARD CHARGE (a Stripe subscription) as well as by monthly invoice.
--
-- billing_method 'invoice'             → the existing path: a clearear_recurring row drafts an invoice each month.
-- billing_method 'stripe_subscription' → no recurring row; the client signs up once on /subscribe/<signup_token>
--                                        (Stripe Checkout), Stripe charges the card monthly, and each paid Stripe
--                                        invoice lands in the books as its own paid BLV invoice + payment + fee
--                                        expense (webhook). A new subscription retainer is 'pending' until the client
--                                        signs up; pending isn't billing and doesn't count toward MRR.

alter table public.clearear_retainers
  add column if not exists billing_method text not null default 'invoice',
  add column if not exists signup_token text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists subscription_status text,          -- Stripe's own: trialing/active/past_due/unpaid/canceled/…
  add column if not exists current_period_end timestamptz,    -- when the next charge falls
  add column if not exists last_payment_at timestamptz,
  add column if not exists last_failure_at timestamptz,       -- the last failed charge (cleared by the next good one)
  add column if not exists last_failure_reason text;

alter table public.clearear_retainers drop constraint if exists clearear_retainers_billing_method_check;
alter table public.clearear_retainers add constraint clearear_retainers_billing_method_check
  check (billing_method in ('invoice', 'stripe_subscription'));

-- an invoice retainer owns its recurring row; a card subscription has none
alter table public.clearear_retainers alter column recurring_id drop not null;
alter table public.clearear_retainers drop constraint if exists clearear_retainers_billing_link_check;
alter table public.clearear_retainers add constraint clearear_retainers_billing_link_check
  check ((billing_method = 'invoice') = (recurring_id is not null));

alter table public.clearear_retainers drop constraint if exists clearear_retainers_status_check;
alter table public.clearear_retainers add constraint clearear_retainers_status_check
  check (status in ('pending', 'active', 'paused', 'ended'));

create unique index if not exists clearear_retainers_signup_token_key on public.clearear_retainers (signup_token) where signup_token is not null;
create unique index if not exists clearear_retainers_stripe_subscription_key on public.clearear_retainers (stripe_subscription_id) where stripe_subscription_id is not null;

-- each monthly card charge's BLV invoice points back at its retainer and its Stripe invoice (one each, never twice)
alter table public.clearear_invoices
  add column if not exists retainer_id uuid references public.clearear_retainers(id) on delete set null,
  add column if not exists stripe_invoice_id text;
create unique index if not exists clearear_invoices_stripe_invoice_key on public.clearear_invoices (stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists clearear_invoices_retainer_idx on public.clearear_invoices (retainer_id) where retainer_id is not null;
