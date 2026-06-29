-- Adds a nullable `niche` slug column to prospects so the composer
-- and researcher can route prompts per vertical (solar, medspa, etc.).
-- Niche values are slugs defined in code (src/lib/niches/*), NOT an
-- enum — adding a new niche is one file, not a migration.
--
-- Existing rows all get NULL and the composer falls back to the
-- generic prompt when niche is NULL (or status='scaffold').
--
-- Idempotent: safe to re-apply.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS niche TEXT;

CREATE INDEX IF NOT EXISTS prospects_niche_idx ON prospects (niche);

COMMENT ON COLUMN prospects.niche
  IS 'Vertical/industry slug from src/lib/niches/. NULL = not yet classified — composer falls back to generic prompt.';
