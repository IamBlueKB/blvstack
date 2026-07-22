-- Recommendation de-duplication support. A recurring call (the weekly PSRx brief
-- re-raising the same advice) becomes ONE row that ages from its first sighting
-- and counts how many times it has been re-raised, instead of N rows that split
-- the signal and inflate the open-rec count.

ALTER TABLE janet_recommendations
  ADD COLUMN IF NOT EXISTS repeat_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Backfill: an existing rec was last seen when it was made (made_at is its
-- created_at). Never leave it null and never invent a fresher timestamp.
UPDATE janet_recommendations SET last_seen_at = made_at WHERE last_seen_at IS NULL;
