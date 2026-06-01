-- =============================================================================
-- BLVBooker — Expand verticals to include 'singer' and 'rapper'
-- Run AFTER booker-schema.sql.
-- Fully additive — only relaxes existing CHECK constraints to allow more values.
-- Existing rows are unaffected.
-- =============================================================================

-- booker_artists.performer_type
ALTER TABLE booker_artists DROP CONSTRAINT IF EXISTS booker_artists_performer_type_check;
ALTER TABLE booker_artists
  ADD CONSTRAINT booker_artists_performer_type_check
  CHECK (performer_type IN ('dj','rapper','singer','band','musician','poet','visual_artist','other'));

-- booker_sources.vertical
ALTER TABLE booker_sources DROP CONSTRAINT IF EXISTS booker_sources_vertical_check;
ALTER TABLE booker_sources
  ADD CONSTRAINT booker_sources_vertical_check
  CHECK (vertical IN ('dj','rapper','singer','band','musician','poet','visual_artist','any'));

-- booker_gigs.vertical
ALTER TABLE booker_gigs DROP CONSTRAINT IF EXISTS booker_gigs_vertical_check;
ALTER TABLE booker_gigs
  ADD CONSTRAINT booker_gigs_vertical_check
  CHECK (vertical IN ('dj','rapper','singer','band','musician','poet','visual_artist','any'));

-- =============================================================================
-- END verticals expansion
-- =============================================================================
