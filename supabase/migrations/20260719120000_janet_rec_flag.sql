-- Recommendation hygiene (Phase 5.4). When a deal reaches an outcome, its still-open
-- linked recommendations get flagged for resolution so they stop injecting into every
-- prompt forever (zombie recs). A nullable flag + reason — no behaviour change until set.

alter table janet_recommendations add column if not exists flagged_at timestamptz;
alter table janet_recommendations add column if not exists flagged_reason text;

notify pgrst, 'reload schema';
