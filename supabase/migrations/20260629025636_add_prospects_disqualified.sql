-- Disqualification as proper prospect state, not a copy field.
--
-- Set by the researcher when a niche's disqualifyingSignals match
-- (e.g. "national door-knocker" for solar). Composer + send batch
-- both skip disqualified prospects.
--
-- Partial index makes "show me disqualified" queries fast without
-- bloating the index for the common false case.
--
-- Idempotent: safe to re-apply.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS disqualified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS disqualified_reason TEXT;

CREATE INDEX IF NOT EXISTS prospects_disqualified_idx
  ON prospects (disqualified)
  WHERE disqualified = TRUE;

COMMENT ON COLUMN prospects.disqualified
  IS 'Set TRUE by researcher when niche disqualifying signals match. Composer + send batch skip TRUE rows.';

COMMENT ON COLUMN prospects.disqualified_reason
  IS 'Free-text reason from the researcher (e.g. "National door-knocker — Sunrun affiliate").';
