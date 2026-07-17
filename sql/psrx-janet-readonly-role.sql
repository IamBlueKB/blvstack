-- ============================================================================
-- JANET read-only role for PSRx Supabase (project brauzztexqtihmwqrrcj)
-- ----------------------------------------------------------------------------
-- Grants BLVSTACK's JANET operator SELECT access to PSRx operational data, plus
-- exactly ONE write lane: INSERT on janet_lead_drafts (the approval queue JANET
-- drops pending follow-up drafts into; a PSRx staffer approves/sends). This is
-- the verified live shape (probed 2026-07-17: SELECT on 28 tables, INSERT only
-- on janet_lead_drafts, NO update/delete anywhere). Idempotent: re-running the
-- grants is safe; only the CREATE/ALTER ROLE line sets the password.
--
-- ⚠ The draft lane (SELECT + INSERT on janet_lead_drafts) is LOAD-BEARING: nurture
--   drafting fails without it. It was missing from an earlier version of this file
--   (Finding G) — do not remove it.
--
-- ⚠ WARNING: re-running the password line desyncs the connection string stored
--   in BLVSTACK's PSRX_DATABASE_URL (.env.local + Vercel). Only change the
--   password deliberately, then update PSRX_DATABASE_URL to match.
--
-- Run in the PSRx Supabase SQL editor (the account that owns PSRx's Supabase),
-- or via the Management API query endpoint for project brauzztexqtihmwqrrcj.
-- ============================================================================

do $$
declare
  t text;
  -- Operational tables JANET reasons over. Missing tables are skipped, so this
  -- is safe even though the live DB is behind the repo's migrations (e.g. no
  -- `reviews` table; `instagram_*`/`popup_metrics` may not exist).
  targets text[] := array[
    'assessment_leads','lead_messages','tattoo_analyses','janet_lead_drafts',
    'portal_members','portal_assessments','portal_protocols','portal_checkins',
    'portal_skin_scores','portal_compliance','portal_booking_requests',
    'portal_products','portal_content','portal_automation_settings',
    'portal_automation_log','portal_guardrail_rules',
    'providers','tasks','audit_log','system_health_checks','uptime_checks',
    'partner_applications','meta_campaigns','reviews','popup_metrics','blog_posts',
    'instagram_rules','instagram_cooldowns','instagram_automation_log'
  ];
begin
  -- 1. The login role (choose a strong password on first create).
  if not exists (select from pg_roles where rolname = 'janet_readonly') then
    create role janet_readonly with login password 'CHOOSE_A_STRONG_PASSWORD';
  end if;

  -- 2. Schema usage.
  grant usage on schema public to janet_readonly;

  -- 3. SELECT on each operational table that exists.
  foreach t in array targets loop
    if exists (select from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('grant select on public.%I to janet_readonly', t);
    end if;
  end loop;

  -- 3a. staff: COLUMN-LEVEL grant that EXCLUDES the plaintext `password` column.
  if exists (select from information_schema.tables where table_schema = 'public' and table_name = 'staff') then
    execute 'grant select (id, first_name, last_name, email, role, active, can_analyzer, can_assessment, can_tasks, created_at) on public.staff to janet_readonly';
  end if;

  -- 3b. THE ONE WRITE LANE: INSERT on janet_lead_drafts (the approval queue).
  --     This is the single non-read privilege the role has, and nurture drafting
  --     depends on it. SELECT is already granted above via `targets`.
  if exists (select from information_schema.tables where table_schema = 'public' and table_name = 'janet_lead_drafts') then
    execute 'grant insert on public.janet_lead_drafts to janet_readonly';
  end if;
end $$;

-- NOTE: app_settings is intentionally NOT granted — it holds the admin password
-- and integration tokens. Expose specific non-secret keys via a view if ever needed.

-- 4. RLS is enabled on these tables, so the role must bypass it to read rows.
--    (Confirmed permitted for the Supabase `postgres` role on this project.)
alter role janet_readonly bypassrls;

-- ----------------------------------------------------------------------------
-- Connection (Supavisor transaction pooler, from the Supabase dashboard):
--   postgresql://janet_readonly.brauzztexqtihmwqrrcj:PASSWORD@aws-1-us-east-1.pooler.supabase.com:6543/postgres
-- Stored in BLVSTACK as PSRX_DATABASE_URL. The `postgres` client must use
-- prepare:false (transaction pooler) and one round-trip per snapshot query
-- (concurrent pipelined queries deadlock the pooler).
-- ============================================================================
