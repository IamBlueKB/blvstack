-- Clear Ear Books — Phase 1: expenses, categories, recurring, mileage, period lock.
-- Incorporates addendum: A1 (recurring created before expenses), A3 (deductible_pct),
-- A4 (mileage), A8 (books_closed_through), A10 (system_generated), A11 (credit +
-- amount <> 0 so refunds/credits are representable).

create table if not exists clearear_expense_categories (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  deductible_default boolean not null default true,
  deductible_pct numeric(5,2) not null default 100.00 check (deductible_pct between 0 and 100),
  sort_order int not null default 0,
  active boolean not null default true
);

-- A1: recurring must exist before expenses references it.
create table if not exists clearear_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  amount numeric(12,2) not null check (amount > 0),
  category_key text not null references clearear_expense_categories(key),
  method text not null,
  day_of_month int not null check (day_of_month between 1 and 28),
  notes text,
  active boolean not null default true,
  last_generated_on date,
  created_at timestamptz not null default now()
);

create table if not exists clearear_expenses (
  id uuid primary key default gen_random_uuid(),
  spent_at date not null,
  vendor text not null,
  amount numeric(12,2) not null check (amount <> 0),          -- A11
  category_key text not null references clearear_expense_categories(key),
  method text not null,
  reference text,
  notes text,
  deductible boolean not null default true,
  deductible_pct numeric(5,2) not null default 100.00 check (deductible_pct between 0 and 100), -- A3
  is_owner_draw boolean not null default false,
  system_generated boolean not null default false,           -- A10
  credit_of_expense_id uuid references clearear_expenses(id), -- A11
  receipt_url text,
  recurring_id uuid references clearear_recurring_expenses(id),
  contractor_contact_id uuid references clearear_contacts(id),
  idempotency_key text unique,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clearear_expenses_spent_at_idx on clearear_expenses (spent_at desc);
create index if not exists clearear_expenses_category_idx on clearear_expenses (category_key);

-- A4: mileage is miles × per-year rate, not an expense row. rate_cents stored per
-- row so prior years don't shift when the IRS rate changes.
create table if not exists clearear_mileage (
  id uuid primary key default gen_random_uuid(),
  drove_on date not null,
  purpose text not null,
  miles numeric(10,1) not null check (miles > 0),
  rate_cents int not null,
  start_location text,
  end_location text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists clearear_mileage_drove_on_idx on clearear_mileage (drove_on desc);

-- A8: period lock.
alter table clearear_settings add column if not exists books_closed_through date;

insert into clearear_expense_categories (key,label,deductible_pct,sort_order) values
  ('rent','Rent',100,10),
  ('utilities','Utilities',100,20),
  ('software','Software & subscriptions',100,30),
  ('gear','Gear & equipment',100,40),
  ('supplies','Supplies',100,50),
  ('fees','Processing & bank fees',100,60),
  ('travel','Travel',100,70),
  ('meals','Meals',50,80),
  ('entertainment','Entertainment',0,90),
  ('contractors','Contractors',100,100),
  ('marketing','Marketing',100,110),
  ('other','Other',100,120)
on conflict (key) do nothing;

notify pgrst,'reload schema';
