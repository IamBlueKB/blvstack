-- JANET - The Dreaming Phase, D2: the proposal store.
--
-- Every durable change a dream wants to make lands here FIRST as a proposal,
-- never a silent rewrite. Consolidate (D2) and Synthesize (D3) both write here.
-- Only exact-duplicate memory merges are created auto_applied; everything else
-- waits for Blue's accept/reject in the morning brief (D4).
--
-- Rail 1 (anti-self-hypnosis): provenance links point at PRIMARY rows only
-- (janet_memory, janet_observations, janet_deals, ...) and NEVER at another
-- janet_dream_proposals row. Dreams consolidate from source records, not from
-- prior dream output. Enforced in code (createProposal) and reasserted here in a
-- comment as the contract.

CREATE TABLE IF NOT EXISTS janet_dream_proposals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_run_at  TIMESTAMPTZ NOT NULL DEFAULT now(),          -- groups one night's proposals (the dream journal)
  job           TEXT NOT NULL,                               -- 'consolidate' | 'synthesize'
  kind          TEXT NOT NULL,                               -- consolidate: merge|deprecate|promote ; synthesize: pattern|graveyard|strategy
  summary       TEXT NOT NULL,                               -- one line: what she proposes
  rationale     TEXT,                                        -- why, grounded in the provenance rows
  target_table  TEXT,                                        -- primary table the change would touch (e.g. 'janet_memory')
  target_id     UUID,                                        -- the specific row to change/deprecate (nullable)
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,          -- concrete change spec (e.g. {keep_id, deactivate_ids} or {category,content})
  provenance    JSONB NOT NULL DEFAULT '[]'::jsonb,          -- [{table,id}] PRIMARY rows only - never janet_dream_proposals
  status        TEXT NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','accepted','rejected','auto_applied')),
  auto_apply    BOOLEAN NOT NULL DEFAULT FALSE,              -- true only for exact-duplicate merges
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT
);

CREATE INDEX IF NOT EXISTS janet_dream_proposals_status_idx
  ON janet_dream_proposals (status, dream_run_at DESC);
CREATE INDEX IF NOT EXISTS janet_dream_proposals_run_idx
  ON janet_dream_proposals (dream_run_at DESC);
