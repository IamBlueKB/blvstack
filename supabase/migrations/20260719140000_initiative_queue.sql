-- Initiative loop / morning-queue console (Phase 6). The approval queue becomes the
-- primary surface: prepared decisions ranked by priority/value, each with its
-- drafted action (proposals → the Phase 2 executor on approve) and its evidence.
-- These columns enrich the existing queue; chat-turn proposals default kind='chat'.

alter table janet_pending_approvals add column if not exists kind text not null default 'chat'; -- 'chat' | 'initiative' | 'cron'
alter table janet_pending_approvals add column if not exists priority int not null default 0;    -- higher = surfaced first
alter table janet_pending_approvals add column if not exists value_estimate numeric;             -- $ at stake, when known
alter table janet_pending_approvals add column if not exists evidence text;                      -- why this, grounded in a record

create index if not exists janet_pending_approvals_queue_idx
  on janet_pending_approvals (status, priority desc, created_at desc);

notify pgrst, 'reload schema';
