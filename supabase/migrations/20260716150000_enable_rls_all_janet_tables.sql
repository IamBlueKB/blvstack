-- Encode RLS in source for every service-role-only table.
--
-- These tables ARE already RLS-enabled on the live DB (enabled out-of-band via
-- the dashboard/Management API), so this migration is a NO-OP against production.
-- Its purpose is to close the source↔state gap flagged in the architecture audit
-- (§7-A): the original migrations never emitted `enable row level security`, so a
-- clean rebuild from source would ship these tables OPEN. This makes source match
-- reality and prevents that regression.
--
-- No policies are added: RLS-on with no policy = the service role (supabaseAdmin,
-- server-side) bypasses and reads/writes everything; anon/authenticated get NOTHING
-- via PostgREST. `if exists` keeps it safe if a table is renamed/dropped later.
-- Enabling already-enabled RLS is idempotent.

-- Core JANET (conversation / memory / audit)
alter table if exists janet_messages          enable row level security;
alter table if exists janet_memory            enable row level security;
alter table if exists janet_actions           enable row level security;
alter table if exists janet_briefings         enable row level security;
alter table if exists janet_pending_approvals enable row level security;
alter table if exists janet_threads           enable row level security;

-- Deals / clients / sites
alter table if exists janet_clients           enable row level security;
alter table if exists janet_sites             enable row level security;
alter table if exists janet_site_scans        enable row level security;
alter table if exists janet_deals             enable row level security;
alter table if exists janet_outcomes          enable row level security;

-- Docs / published pages / forms
alter table if exists janet_docs                  enable row level security;
alter table if exists janet_doc_versions          enable row level security;
alter table if exists janet_doc_templates         enable row level security;
alter table if exists janet_published_pages       enable row level security;
alter table if exists janet_page_views            enable row level security;
alter table if exists janet_page_recipient_links  enable row level security;
alter table if exists janet_form_responses        enable row level security;

-- Judgment / ledger
alter table if exists janet_recommendations   enable row level security;
alter table if exists janet_graveyard         enable row level security;
alter table if exists janet_reasoning_patterns enable row level security;
alter table if exists janet_predictions       enable row level security;

-- PSRx orchestration (patient-lead PII)
alter table if exists janet_psrx_followups    enable row level security;
alter table if exists janet_psrx_suppression  enable row level security;
alter table if exists janet_client_briefs     enable row level security;

-- Notepad
alter table if exists janet_notepad_sessions  enable row level security;
alter table if exists janet_question_bank     enable row level security;

-- Sent-mail log
alter table if exists janet_sent_emails       enable row level security;

-- Outbound / prospects (sql/outbound-tables.sql — never had RLS in source)
alter table if exists prospects               enable row level security;
alter table if exists outbound_emails         enable row level security;
alter table if exists suppression_list        enable row level security;
alter table if exists outbound_settings       enable row level security;

notify pgrst, 'reload schema';
