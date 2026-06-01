-- =============================================================================
-- BLVBooker — Add intake_expires_at column to booker_artists
-- Run AFTER booker-schema.sql.
-- Fully additive — adds one nullable column.
-- =============================================================================

ALTER TABLE booker_artists
  ADD COLUMN IF NOT EXISTS intake_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_booker_artists_intake_expires_at
  ON booker_artists(intake_expires_at)
  WHERE intake_expires_at IS NOT NULL;
