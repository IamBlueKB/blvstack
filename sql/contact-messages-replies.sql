-- =============================================================================
-- BLVSTACK — Add reply tracking to contact_messages
-- AI-drafted + sent replies live on the message row.
-- =============================================================================

ALTER TABLE contact_messages
  ADD COLUMN IF NOT EXISTS draft_subject     text,
  ADD COLUMN IF NOT EXISTS draft_body        text,
  ADD COLUMN IF NOT EXISTS replied_at        timestamptz,
  ADD COLUMN IF NOT EXISTS replied_subject   text,
  ADD COLUMN IF NOT EXISTS replied_body      text,
  ADD COLUMN IF NOT EXISTS replied_by_email  text,
  ADD COLUMN IF NOT EXISTS resend_message_id text;
