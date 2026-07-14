-- Approval audit-trail fix: a pending approval remembers which thread it came
-- from, so the "Executed"/"Rejected" decision-note written on resolve lands in
-- that thread's history (history is thread-scoped since Feature 1). Without this,
-- decision notes were written with a null thread_id and vanished from every
-- thread view — a hole in the one system that must not have holes.
alter table janet_pending_approvals add column if not exists thread_id uuid references janet_threads(id);
