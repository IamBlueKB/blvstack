-- ═══════════════════════════════════════════════════════
-- BLVSTACK Outbound Lead Generation System — DB Schema
-- ═══════════════════════════════════════════════════════

-- 1. Prospects table
CREATE TABLE IF NOT EXISTS prospects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Source
  source_url    text,                 -- URL they were scraped from

  -- Company info (populated by scraper + researcher)
  company_name  text,
  company_url   text,
  contact_name  text,
  contact_email text,

  -- AI research
  pain_points   text,                 -- AI-identified problems
  ai_research   jsonb,                -- full research output

  -- Outreach
  draft_subject text,
  draft_email   text,                 -- composed outreach
  approved      boolean DEFAULT false,

  -- Gmail tracking
  gmail_thread_id  text,
  gmail_message_id text,

  -- Pipeline
  status        text NOT NULL DEFAULT 'new'
                CHECK (status IN (
                  'new','researched','composed','queued','sent',
                  'follow_up_1','follow_up_2','follow_up_3',
                  'replied','booked','dead','suppressed'
                )),
  last_sent_at      timestamptz,
  next_follow_up_at timestamptz,
  follow_up_count   int NOT NULL DEFAULT 0,
  replied_at        timestamptz,

  notes         text
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_next_follow_up ON prospects(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_contact_email ON prospects(contact_email);

-- 2. Outbound emails log
CREATE TABLE IF NOT EXISTS outbound_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id   uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),

  type          text NOT NULL CHECK (type IN ('initial','follow_up_1','follow_up_2','follow_up_3')),
  subject       text NOT NULL,
  body          text NOT NULL,

  gmail_message_id text,
  gmail_thread_id  text,

  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','bounced','replied'))
);

CREATE INDEX IF NOT EXISTS idx_outbound_emails_prospect ON outbound_emails(prospect_id);

-- 3. Suppression list
CREATE TABLE IF NOT EXISTS suppression_list (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  reason     text NOT NULL CHECK (reason IN ('unsubscribed','bounced','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);

-- 4. Outbound settings (key-value)
CREATE TABLE IF NOT EXISTS outbound_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Seed defaults
INSERT INTO outbound_settings (key, value) VALUES
  ('daily_cap', '10'),
  ('warmup_complete', 'false'),
  ('follow_up_days', '4,10,21'),
  ('gmail_connected', 'false')
ON CONFLICT (key) DO NOTHING;
