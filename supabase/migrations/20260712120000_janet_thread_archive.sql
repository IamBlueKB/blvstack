-- JANET "New chat" (v2 spec 1.6): archive the current thread, start clean.
-- janet_memory is a SEPARATE table and is never touched — resetting the
-- conversation must never wipe what she's learned. Archived messages are kept
-- (recoverable), just excluded from the active thread.
ALTER TABLE janet_messages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS janet_messages_active_idx ON janet_messages (created_at DESC) WHERE archived_at IS NULL;
