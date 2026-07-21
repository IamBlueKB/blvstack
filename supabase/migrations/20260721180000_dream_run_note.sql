-- Run-level explanation on a dream run. Set when the run is 'inconsistent':
-- the journal reported success that the accounting contradicts ($0 spent with
-- no model call recorded). The status alone says something is wrong; the note
-- says WHICH of the two causes to investigate, so the finding survives past the
-- morning it was produced.

ALTER TABLE janet_dream_runs ADD COLUMN IF NOT EXISTS note TEXT;
