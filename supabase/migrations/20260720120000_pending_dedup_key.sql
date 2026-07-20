-- Robust dedup for the initiative queue (Phase 6.2 follow-up). A "blocked — missing
-- data" item has no executable proposal, so it can't be deduped by reconstructing a
-- key from its proposals. Store the dedup key explicitly on the row instead.

alter table janet_pending_approvals add column if not exists dedup_key text;
create index if not exists janet_pending_approvals_dedup_idx on janet_pending_approvals (status, dedup_key);

notify pgrst, 'reload schema';
