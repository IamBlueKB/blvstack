-- JANET proactive lead handling (v2 spec 1.2-1.4).
-- ai_draft_reply: a reply JANET auto-drafts on lead arrival, waiting for Blue.
-- urgency: hot | warm | cold — so hot leads rank first, not like tire-kickers.
-- first_response_at: speed-to-lead measurement (arrival -> first response).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_draft_reply TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS urgency TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
