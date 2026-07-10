-- JANET notepad: persist the ordered editor block structure (Task 3 editor v2).
-- Blocks = the ordered list of { type:'text', text } and { type:'question',
-- topic, question, answer } that make up a session. Source of truth for the UI;
-- `notes` (serialized transcript) and `coverage` stay derived from it for JANET.
ALTER TABLE janet_notepad_sessions ADD COLUMN IF NOT EXISTS blocks jsonb NOT NULL DEFAULT '[]'::jsonb;
