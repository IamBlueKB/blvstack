-- JANET discovery notepad (JANET_ADMIN_NOTEPAD_SPEC Task 3)

-- A capture session for a discovery call. deal_id null = standalone (attach later).
CREATE TABLE IF NOT EXISTS janet_notepad_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES janet_deals(id) ON DELETE SET NULL,
  title TEXT,                                 -- contact name / "Unexpected call"
  context TEXT,                               -- network-contact info Blue feeds in
  deal_type TEXT,                             -- 'refresh' | 'new_build' | 'rescue' | null
  prepped_questions JSONB DEFAULT '[]'::jsonb, -- [{ q, kind }]  kind: prospect|standard|type
  notes TEXT NOT NULL DEFAULT '',
  pending_fields JSONB,                        -- extracted draft fields awaiting confirmation
  recap TEXT,
  status TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'processed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS janet_notepad_deal_idx ON janet_notepad_sessions (deal_id);
CREATE INDEX IF NOT EXISTS janet_notepad_created_idx ON janet_notepad_sessions (created_at DESC);

-- Editable question bank: standard baseline (deal_type NULL) + per-deal-type templates.
CREATE TABLE IF NOT EXISTS janet_question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  deal_type TEXT,                              -- NULL = standard baseline
  sort INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the standard discovery question set (spec Task 3). Idempotent: only seeds
-- when the bank is empty.
INSERT INTO janet_question_bank (text, deal_type, sort)
SELECT v.text, v.deal_type, v.sort FROM (VALUES
  ('What''s the actual problem driving this? (the underlying problem, not the stated want)', NULL::text, 1),
  ('Current state — what do you have now, what''s broken?', NULL, 2),
  ('Who''s the decision-maker? Anyone else involved?', NULL, 3),
  ('Budget range?', NULL, 4),
  ('Timeline / urgency — and what''s driving it?', NULL, 5),
  ('What does success look like? How will you know it worked?', NULL, 6),
  ('Scope — what''s in, what''s explicitly out?', NULL, 7),
  ('Existing assets — site, brand, content, systems?', NULL, 8),
  ('Worked with anyone before? Why did it end?', NULL, 9),
  ('What happens if you do nothing? (cost of inaction)', NULL, 10),
  ('What specifically feels dated or off about the current site?', 'refresh', 1),
  ('What''s working now that we must NOT lose in the refresh?', 'refresh', 2),
  ('Is this a rebrand, or same brand better executed?', 'refresh', 3),
  ('Since it''s greenfield — what''s the one job this must do on day one?', 'new_build', 1),
  ('What have you seen (competitors/inspiration) that you want to beat?', 'new_build', 2),
  ('What went wrong with the current build, and who built it?', 'rescue', 1),
  ('Is the goal to salvage/stabilize, or replace?', 'rescue', 2)
) AS v(text, deal_type, sort)
WHERE NOT EXISTS (SELECT 1 FROM janet_question_bank);
