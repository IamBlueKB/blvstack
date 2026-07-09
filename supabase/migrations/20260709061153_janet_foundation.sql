-- JANET v1 — Phase 1 foundation tables (spec/JANET_V1_SPEC.md §3)
-- One continuous conversation, memory, append-only action audit,
-- daily briefings, connected-site portfolio, scan history, deal pipeline.

-- One continuous conversation, message by message
CREATE TABLE janet_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content JSONB NOT NULL,            -- message content blocks (text / tool_use / tool_result)
  page_context JSONB,                -- what page Blue was on, what record was open
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX janet_messages_created_idx ON janet_messages (created_at DESC);

-- What JANET has learned / been taught. Blue can view + edit all of it.
CREATE TABLE janet_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,            -- 'preference' | 'pricing' | 'playbook' | 'correction' | 'fact'
  content TEXT NOT NULL,             -- plain-language memory entry
  source TEXT,                       -- how it was learned (conversation date, outcome, manual)
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX janet_memory_category_idx ON janet_memory (category) WHERE active = TRUE;

-- Audit trail of everything she does. Append-only. She has no write access to this via tools.
CREATE TABLE janet_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  ring SMALLINT NOT NULL,
  input JSONB NOT NULL,
  output_summary TEXT,
  approved_by_user BOOLEAN,          -- null for ring 1/2, true/false for ring 3
  status TEXT NOT NULL DEFAULT 'completed',  -- 'completed' | 'failed' | 'rejected'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX janet_actions_created_idx ON janet_actions (created_at DESC);

-- Daily briefings she generates
CREATE TABLE janet_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_date DATE NOT NULL UNIQUE,
  content JSONB NOT NULL,            -- structured briefing sections
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Connected sites (portfolio: PSRx, Precise, Indiethis, + every new build)
CREATE TABLE janet_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  production_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'development' | 'archived'
  client_name TEXT,
  repo_url TEXT,
  retainer_status TEXT DEFAULT 'none',     -- 'none' | 'pitched' | 'active'
  retainer_monthly NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Health/QA scan results per site over time
CREATE TABLE janet_site_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES janet_sites(id),
  scan_type TEXT NOT NULL,           -- 'uptime' | 'standard' | 'lighthouse' | 'full_audit'
  results JSONB NOT NULL,            -- structured findings
  passed INT,                        -- checks passed
  failed INT,                        -- checks failed
  score NUMERIC,                     -- overall score where applicable
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX janet_site_scans_site_idx ON janet_site_scans (site_id, created_at DESC);

-- Deal/inquiry pipeline (formalizes what's currently loose in the panel)
CREATE TABLE janet_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                -- 'Interior design refresh — [name]'
  contact_name TEXT,
  contact_email TEXT,
  source TEXT,                       -- 'referral' | 'inbound' | 'outbound' | 'network'
  referred_by TEXT,
  stage TEXT NOT NULL DEFAULT 'inquiry',
    -- 'inquiry' | 'discovery_scheduled' | 'discovery_done' | 'proposal_sent'
    -- | 'negotiating' | 'won' | 'building' | 'delivered' | 'lost'
  value_estimate NUMERIC,
  site_id UUID REFERENCES janet_sites(id),  -- linked once build starts
  next_action TEXT,
  next_action_due DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX janet_deals_stage_idx ON janet_deals (stage);
