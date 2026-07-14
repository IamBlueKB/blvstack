-- JANET PSRx re-engagement scheduler (Phase 4B follow-up). JANET's own planning
-- table (BLVSTACK-side, she controls it fully). The schedule of WHO to re-engage
-- and WHEN — the interval comes from the lead's stated timeline, her judgment sets
-- the date. On the review date a cron drafts FRESH and drops a pending row into
-- PSRx's janet_lead_drafts (the INSERT-only approval lane); nothing auto-sends.
--
-- Doubles as the learning-loop log (which timeline bucket, what interval she chose,
-- her reasoning, and the eventual outcome) — the hook that lets cadence become
-- empirical later without a rebuild.

create table if not exists janet_psrx_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  lead_email text,
  lead_name text,
  timeline_bucket text,                 -- the lead's STATED intent: 'asap'|'1mo'|'3mo'|'researching'|'other'|'none'
  review_on date not null,              -- when to resurface (JANET's decision, from the timeline + last contact)
  follow_up_number int not null default 1,
  qualification_reasoning text not null,-- why this lead is (or isn't) worth re-engaging
  cadence_reasoning text,               -- why this interval, honoring the lead's own words
  confidence numeric,
  status text not null default 'scheduled', -- scheduled | released | declined | cancelled | converted
  recommendation_id uuid,               -- ledger row
  draft_id uuid,                        -- the janet_lead_drafts pending row, once released
  released_at timestamptz,
  outcome text,                         -- 'converted' | 'no_response' | 'unsubscribed' | null (learning loop)
  outcome_recorded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists janet_psrx_followups_due_idx on janet_psrx_followups (status, review_on);
create index if not exists janet_psrx_followups_lead_idx on janet_psrx_followups (lead_id);
