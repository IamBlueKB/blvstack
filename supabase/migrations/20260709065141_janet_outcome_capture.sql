-- JANET v1 — outcome capture substrate (v1 addition, approved 2026-07-09)
-- Capture only, no reasoning. Records WHETHER drafted artifacts landed and
-- WHY deals closed the way they did, from day one, so the v2 self-updating
-- playbook loop has real data to reason over. JANET reads this freely
-- (Ring 1); writes happen when Blue tags an outcome in the UI or tells her.

-- Deal-level outcome: distinct from `stage` because stage keeps moving after
-- a win (won -> building -> delivered) while the verdict + reason must persist.
ALTER TABLE janet_deals
  ADD COLUMN outcome TEXT CHECK (outcome IN ('won', 'lost')),
  ADD COLUMN outcome_reason TEXT,
  ADD COLUMN outcome_at TIMESTAMPTZ;

-- Artifact-level outcomes: one row per verdict on something JANET produced
-- (proposal, retainer pitch, email, suggestion). Linked to the janet_actions
-- row that produced the artifact when known. Separate table (not a column on
-- janet_actions) so the audit trail stays append-only.
CREATE TABLE janet_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES janet_actions(id),   -- the draft action being tagged (nullable: manual artifacts)
  deal_id UUID REFERENCES janet_deals(id),       -- deal context when applicable
  artifact_type TEXT NOT NULL,   -- 'proposal' | 'retainer_pitch' | 'email' | 'suggestion' | 'other'
  outcome TEXT NOT NULL,         -- 'accepted' | 'ignored' | 'rejected' | 'converted'
  reason TEXT,                   -- Blue's words on why, verbatim where possible
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX janet_outcomes_deal_idx ON janet_outcomes (deal_id, created_at DESC);
CREATE INDEX janet_outcomes_type_idx ON janet_outcomes (artifact_type, outcome);
