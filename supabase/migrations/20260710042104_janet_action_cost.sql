-- JANET cost governance (JANET_ADMIN_NOTEPAD_SPEC Task 1): per-turn API cost
-- logged to the audit trail so spend is auditable in /admin/janet-activity.
ALTER TABLE janet_actions ADD COLUMN IF NOT EXISTS cost NUMERIC;
ALTER TABLE janet_actions ALTER COLUMN ring DROP NOT NULL;  -- turn-cost rows have no ring
