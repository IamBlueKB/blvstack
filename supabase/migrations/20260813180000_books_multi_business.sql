-- Books go multi-business: Clear Ear Studios + BLVSTACK, one engine, separate books.
-- Same legal entity (one return), so the period lock stays entity-wide and a combined
-- P&L is meaningful — but every money row belongs to exactly ONE business.
--
-- business is NOT NULL with NO DEFAULT everywhere it appears: a row with no business
-- would silently land in the wrong view or none at all. Existing rows backfill to
-- 'clearear' explicitly (that is what they are).

do $$
declare
  t text;
  money_tables text[] := array[
    'clearear_invoices','clearear_invoice_lines','clearear_payments',
    'clearear_expenses','clearear_recurring_expenses','clearear_mileage',
    'clearear_sessions'
  ];
begin
  foreach t in array money_tables loop
    -- 1. add nullable, 2. backfill explicitly, 3. enforce NOT NULL, 4. no default.
    execute format('alter table %I add column if not exists business text', t);
    execute format('update %I set business = ''clearear'' where business is null', t);
    execute format('alter table %I alter column business set not null', t);
    execute format('alter table %I alter column business drop default', t);
    execute format($f$
      do $inner$ begin
        if not exists (select 1 from pg_constraint where conname = '%1$s_business_check') then
          alter table %1$I add constraint %1$s_business_check
            check (business in ('clearear','blvstack'));
        end if;
      end $inner$;
    $f$, t);
    execute format('create index if not exists %I on %I (business)', t || '_business_idx', t);
  end loop;
end $$;

-- ── Settings: one row per business (name/address/logo/tax id differ) ───────
-- Settings were a hard singleton (CHECK id = 1). Two businesses need two rows, so
-- the singleton is replaced by uniqueness on business.
alter table clearear_settings drop constraint if exists clearear_settings_singleton;
alter table clearear_settings add column if not exists business text;
update clearear_settings set business = 'clearear' where business is null;
alter table clearear_settings alter column business set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='clearear_settings_business_key') then
    alter table clearear_settings add constraint clearear_settings_business_key unique (business);
  end if;
end $$;

insert into clearear_settings (id, business, business_name)
select coalesce((select max(id) from clearear_settings), 0) + 1, 'blvstack', 'BLVSTACK'
where not exists (select 1 from clearear_settings where business = 'blvstack');

-- ── Invoice numbering: independent + gapless PER BUSINESS ─────────────────
-- Old counter was keyed on (year) alone with a hardcoded 'CE-' prefix: it could not
-- emit BLV numbers, and both businesses would have shared one sequence. Key becomes
-- (business, year); prefix derives from business.
alter table clearear_invoice_counters add column if not exists business text;
update clearear_invoice_counters set business = 'clearear' where business is null;
alter table clearear_invoice_counters alter column business set not null;

do $$ begin
  -- Drop whatever uniqueness exists on (year) and re-key on (business, year).
  if exists (select 1 from pg_constraint where conrelid='clearear_invoice_counters'::regclass and contype in ('p','u')) then
    execute (
      select string_agg(format('alter table clearear_invoice_counters drop constraint %I', conname), '; ')
      from pg_constraint where conrelid='clearear_invoice_counters'::regclass and contype in ('p','u')
    );
  end if;
  alter table clearear_invoice_counters add primary key (business, year);
end $$;

create or replace function public.next_clearear_invoice_number(p_business text default 'clearear')
returns text language plpgsql as $function$
declare
  y int := extract(year from current_date)::int;
  s int;
  prefix text;
begin
  if p_business not in ('clearear','blvstack') then
    raise exception 'Unknown business %', p_business;
  end if;
  prefix := case p_business when 'clearear' then 'CE' else 'BLV' end;
  insert into clearear_invoice_counters(business, year, last_seq) values (p_business, y, 1)
  on conflict (business, year) do update set last_seq = clearear_invoice_counters.last_seq + 1
  returning last_seq into s;
  return prefix || '-' || y::text || '-' || lpad(s::text, 4, '0');
end;
$function$;

notify pgrst, 'reload schema';
