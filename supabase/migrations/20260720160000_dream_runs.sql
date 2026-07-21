-- JANET - The Dreaming Phase, D4: the nightly run journal.
--
-- One row per nightly dream run: the honest record of what each job did, stored
-- deterministically (no model). The morning brief folds the latest row in, and
-- the dream-journal review page reads it. Kept separate from janet_briefings so
-- the heartbeat's brief upsert can never clobber it.
--
-- The honesty contract (trust stack): a job that did not finish is recorded as
-- status 'incomplete' with a reason, NEVER as an empty/zero result. "consolidate
-- did not finish tonight" and "consolidate found nothing to merge" are different
-- facts and must read differently.

CREATE TABLE IF NOT EXISTS janet_dream_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_run_at      TIMESTAMPTZ NOT NULL,
  reconcile         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {flagged, closed, staged}
  consolidate       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {status, auto_merged, proposed, note?}
  synthesize        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {status, proposed, note?}
  budget            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {spent, cap}
  proposals_pending INT NOT NULL DEFAULT 0,               -- review-gated proposals from this run
  status            TEXT NOT NULL DEFAULT 'ok',           -- 'ok' | 'partial' (a job was incomplete)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS janet_dream_runs_at_idx ON janet_dream_runs (dream_run_at DESC);
