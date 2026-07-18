-- The action ledger (Phase 2.2) — action-state lives OUTSIDE the model.
--
-- Every consequential action (send / publish / booking) gets one row whose state
-- machine is the source of truth for "did it happen": proposed → approved →
-- executed → verified → reported (or failed / refused). "Did it send?" becomes a
-- DB query, not a language act — survives context resets, reconciled from here,
-- never from the model's prose.
--
-- The unified send executor (lib/janet/executor.ts) writes this: it refuses to
-- execute without an approval_ref, dedups by idempotency_key (a retry after an
-- ambiguous failure can't double-send), and only the read-after-write path (2.3)
-- moves a row to 'verified'.

create table if not exists janet_action_ledger (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,            -- 'send_email' | 'send_lead_reply' | 'send_message_reply' | 'publish' | 'booking' | 'outbound' | 'booker_pitch' | ...
  lane text not null,                   -- 'chat' | 'manual' | 'batch' | 'cron' | 'booker' | 'psrx'
  state text not null default 'proposed', -- proposed | approved | executed | verified | reported | failed | refused
  approval_ref text,                    -- what authorizes execution (janet_pending_approvals id, or an explicit system ref); NULL ⇒ refused
  idempotency_key text not null unique, -- client-generated; same key never re-executes
  payload jsonb,                        -- the action payload (recipient / subject / body / target)
  result jsonb,                         -- provider result (e.g. resend id)
  error text,
  sent_log_id uuid,                     -- link to janet_sent_emails (the one sent-log)
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists janet_action_ledger_state_idx on janet_action_ledger (state, created_at desc);
create index if not exists janet_action_ledger_type_idx on janet_action_ledger (action_type, created_at desc);

alter table janet_action_ledger enable row level security;
-- Service-role only (contains recipient/body payloads). No policies.

notify pgrst, 'reload schema';
