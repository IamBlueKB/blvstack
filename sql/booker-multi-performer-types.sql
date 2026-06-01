-- =============================================================================
-- BLVBooker — Add performer_types text[] (multi-discipline support)
-- Run AFTER booker-schema.sql and booker-verticals-expand.sql.
-- Fully additive — adds a new column and backfills from existing performer_type.
-- The old single-value `performer_type` column stays as the PRIMARY type for
-- backwards compat and list display; the new array is the source of truth for
-- matching when set.
-- =============================================================================

ALTER TABLE booker_artists
  ADD COLUMN IF NOT EXISTS performer_types text[];

-- Backfill: copy existing single value into the array for already-existing rows.
UPDATE booker_artists
   SET performer_types = ARRAY[performer_type]
 WHERE performer_type IS NOT NULL
   AND (performer_types IS NULL OR cardinality(performer_types) = 0);

-- Optional GIN index for fast array membership lookups (matcher reads this).
CREATE INDEX IF NOT EXISTS idx_booker_artists_performer_types
  ON booker_artists USING GIN (performer_types);
