-- Client-site pausing for non-payment (Blue's policy, 2026-10-03: 7-day grace, branded holding page, client emails).
--
-- A site linked to its billing retainer (billing_retainer_id) with auto_suspend on is paused when a card charge has
-- been failing for suspend_grace_days. Pausing = a Vercel Firewall redirect rule on the site's project
-- (vercel_project_id) sending every request to BLVSTACK's /unavailable page; restoring removes the rule. Paying
-- restores it automatically.

alter table public.janet_sites
  add column if not exists vercel_project_id text,
  add column if not exists billing_retainer_id uuid references public.clearear_retainers(id) on delete set null,
  add column if not exists auto_suspend boolean not null default false,
  add column if not exists suspend_grace_days integer not null default 7,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspension_rule_id text;

alter table public.janet_sites drop constraint if exists janet_sites_suspend_grace_days_check;
alter table public.janet_sites add constraint janet_sites_suspend_grace_days_check check (suspend_grace_days between 1 and 60);
create index if not exists janet_sites_billing_retainer_idx on public.janet_sites (billing_retainer_id) where billing_retainer_id is not null;

-- When non-payment began (first failed charge of the episode) and which client notice went out last.
alter table public.clearear_retainers
  add column if not exists past_due_since timestamptz,
  add column if not exists dunning_stage text,
  add column if not exists dunning_notice_at timestamptz;

alter table public.clearear_retainers drop constraint if exists clearear_retainers_dunning_stage_check;
alter table public.clearear_retainers add constraint clearear_retainers_dunning_stage_check
  check (dunning_stage is null or dunning_stage in ('failed', 'final', 'paused'));
