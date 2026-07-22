-- Out-of-band actions Blue takes outside the system - texting a client a
-- proposal, a phone call, an in-person yes. Real events the system should know
-- about (so briefing nags clear and stale-deal timers reset) WITHOUT pretending
-- it performed them.
--
-- system_verified is FALSE BY CONSTRUCTION and has no setter: a reported action
-- advances the pipeline, it is NOT evidence of delivery. Conversion / performance
-- math joins here to exclude or segment these from system-verified sends - a
-- proposal "sent by text" must never count the same as one the executor sent and
-- a webhook confirmed delivered.

CREATE TABLE IF NOT EXISTS janet_external_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor          TEXT NOT NULL,                       -- who did it (e.g. 'blue')
  channel        TEXT NOT NULL,                       -- text | call | in_person | personal_email
  description    TEXT NOT NULL,                       -- what happened, in Blue's words
  occurred_at    TIMESTAMPTZ NOT NULL,                -- when it actually happened (his report)
  subject_type   TEXT,                                -- 'deal' | 'lead' | 'client' | ...
  subject_id     UUID,
  system_verified BOOLEAN NOT NULL DEFAULT false      -- ALWAYS false on this path; no setter exists
    CONSTRAINT janet_external_actions_never_verified CHECK (system_verified = false),
  idempotency_key TEXT UNIQUE,                         -- same report twice does not double-log
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS janet_external_actions_subject_idx ON janet_external_actions (subject_type, subject_id);
