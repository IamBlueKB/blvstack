-- JANET v2 Phase 2 — the accountability ledger (spec §2.1).
-- A first-class record of every recommendation JANET makes: her advice, her
-- reasoning, her stated confidence — then, filled later, what actually happened
-- and Blue's verdict on whether she was right. This is what gives her stakes.

CREATE TABLE IF NOT EXISTS janet_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  made_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  category TEXT NOT NULL,            -- 'lead_triage' | 'deal_action' | 'site_fix' | 'revenue_idea' | 'pricing' | 'outreach' | 'other'
  subject_type TEXT,                 -- 'lead' | 'deal' | 'site' | 'client' | 'prospect' | null
  subject_id UUID,                   -- the record it was about
  subject_label TEXT,                -- human-readable subject (name), so the scorecard reads without a join
  recommendation TEXT NOT NULL,      -- what she recommended
  reasoning TEXT NOT NULL,           -- WHY — her stated reasoning at the time
  confidence NUMERIC,                -- her own confidence 0-1
  -- outcome (filled later)
  status TEXT NOT NULL DEFAULT 'open',
    -- 'open' | 'accepted' | 'rejected' | 'ignored' | 'superseded'
  outcome TEXT,                      -- 'worked' | 'failed' | 'partial' | 'unknown' | null
  outcome_detail TEXT,               -- what actually happened
  outcome_value NUMERIC,             -- $ impact if measurable
  outcome_recorded_at TIMESTAMPTZ,
  blue_verdict TEXT                  -- Blue's judgment: 'right' | 'wrong' | 'mixed' | null
);

CREATE INDEX IF NOT EXISTS janet_recs_status_idx ON janet_recommendations (status);
CREATE INDEX IF NOT EXISTS janet_recs_subject_idx ON janet_recommendations (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS janet_recs_made_at_idx ON janet_recommendations (made_at DESC);
