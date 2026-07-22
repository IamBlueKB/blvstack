-- JANET — The Dreaming Phase: two-phase resumable loop (submit at night, collect
-- later). Additive only — no column dropped, no data rewritten.
--
-- janet_dream_runs gains a state machine and the fields the collector needs to
-- finalize a run submitted hours earlier:
--   state          submitted → collected | failed | expired  (terminal set)
--   submitted_at   the 24h expiry clock starts here
--   collected_at   when the collector wrote the terminal record
--   *_batch_id     the two one-request batch ids to retrieve
--   pending        the SUBMIT-TIME provenance snapshot (per-job id lists) the
--                  collector validates cites against — never a re-fetch
-- state DEFAULT 'collected' backfills the pre-two-phase rows correctly: the old
-- one-phase cron completed synchronously, so every existing row is terminal.

ALTER TABLE janet_dream_runs
  ADD COLUMN IF NOT EXISTS state                TEXT NOT NULL DEFAULT 'collected'
    CHECK (state IN ('submitted','collected','failed','expired')),
  ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collected_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consolidate_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS synthesize_batch_id  TEXT,
  ADD COLUMN IF NOT EXISTS pending              JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Existing rows: they were submitted when they were created. Never invent a time.
UPDATE janet_dream_runs SET submitted_at = created_at WHERE submitted_at IS NULL;

-- The collector's terminal write upserts on dream_run_at (a re-collection UPDATES,
-- never inserts a duplicate). That requires dream_run_at to be unique — it always
-- has been in practice (one distinct stamp per run).
CREATE UNIQUE INDEX IF NOT EXISTS janet_dream_runs_run_uniq ON janet_dream_runs (dream_run_at);
CREATE INDEX IF NOT EXISTS janet_dream_runs_state_idx ON janet_dream_runs (state, submitted_at);

-- Proposal idempotency: a double collection of the same (fixed, temperature-0)
-- batch result must not create duplicate proposals, and must not reset a proposal
-- Blue already reviewed. createProposal upserts on this key with ON CONFLICT DO
-- NOTHING. Partial index: pre-two-phase rows have a NULL key and are exempt.
ALTER TABLE janet_dream_proposals
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS janet_dream_proposals_idem_idx
  ON janet_dream_proposals (idempotency_key) WHERE idempotency_key IS NOT NULL;
