-- The observation store (Phase 2.5) — provenance for consequential claims.
--
-- Every consequential tool RESULT this turn is persisted here keyed by the model's
-- tool-call id + timestamp + source, so a citation ("published? — per observation X")
-- resolves to real provenance and SURVIVES history compaction (the prose-only
-- message replay drops tool blocks; this store does not). A consequential claim
-- with no citable observation is inference by construction and gets blocked (2.5);
-- a grounding read (2.7) requires an observation of the right type younger than its
-- class TTL. Service-role only (payloads can contain PII).

create table if not exists janet_observations (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid,
  tool_call_id text,                       -- the model's tool_use id for this observation
  tool_name text not null,
  source text not null default 'tool',     -- tool | ledger | snapshot
  claim_classes text[] not null default '{}', -- consequential classes this result can ground
  observed_at timestamptz not null default now(),
  payload jsonb                            -- the tool result (capped)
);

create index if not exists janet_observations_thread_idx on janet_observations (thread_id, observed_at desc);
create index if not exists janet_observations_class_idx on janet_observations using gin (claim_classes);

alter table janet_observations enable row level security;
-- Service-role only. No policies.

notify pgrst, 'reload schema';
