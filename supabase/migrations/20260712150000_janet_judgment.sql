-- JANET v2 Phase 3 — judgment (she thinks like Blue). Her memory holds facts;
-- this makes it hold REASONING: what was tried and killed (and why), the patterns
-- behind how Blue decides, and a record of her predictions of his calls so she
-- can measure how well she models him.

-- 3.1 The graveyard — what was tried and killed, and why. Without it she
-- re-suggests dead ideas forever. The reasoning (why_killed) is the valuable part.
CREATE TABLE IF NOT EXISTS janet_graveyard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  killed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idea TEXT NOT NULL,                 -- what was considered
  category TEXT,                      -- 'business_model' | 'product' | 'channel' | 'feature' | 'pricing' | 'client' | 'other'
  why_killed TEXT NOT NULL,           -- the REASONING — this is the valuable part
  killed_by TEXT DEFAULT 'blue',      -- who made the call
  revisit_conditions TEXT,            -- what would have to change for this to become viable again
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS janet_graveyard_active_idx ON janet_graveyard (active);

-- 3.2 Reasoning patterns — a model of how Blue thinks. The principle, not the
-- instance. Confirmed patterns gain confidence; contradicted ones lose it.
CREATE TABLE IF NOT EXISTS janet_reasoning_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern TEXT NOT NULL,              -- "Blue weights long-term trust over short-term conversion"
  evidence TEXT NOT NULL,             -- what he did/said that established this
  domain TEXT,                        -- 'pricing' | 'clients' | 'product' | 'risk' | 'style' | 'strategy' | 'general'
  confidence NUMERIC DEFAULT 0.5,     -- how sure she is this is a real pattern
  times_confirmed INT DEFAULT 0,
  times_contradicted INT DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS janet_patterns_active_idx ON janet_reasoning_patterns (active);

-- 3.4 She tests her model — predictions of Blue's decisions, scored against what he
-- actually did. Accuracy over these is the measure of how well she models him.
CREATE TABLE IF NOT EXISTS janet_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  made_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  context TEXT NOT NULL,              -- the decision she's predicting
  predicted TEXT NOT NULL,            -- what she expects Blue to do
  pattern_id UUID REFERENCES janet_reasoning_patterns(id) ON DELETE SET NULL, -- the pattern that drove the prediction
  subject_type TEXT,                  -- 'lead' | 'deal' | 'site' | 'client' | 'prospect' | null
  subject_id UUID,
  outcome TEXT,                       -- 'correct' | 'incorrect' | 'partial' | null (unresolved)
  actual TEXT,                        -- what Blue actually did
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS janet_predictions_outcome_idx ON janet_predictions (outcome);
