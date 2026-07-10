-- JANET clients — the account entity. A client is the hub everything about a
-- customer rolls up to: their sites, deals, and discovery notes.
CREATE TABLE IF NOT EXISTS janet_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                 -- account / business name
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'prospect' | 'active' | 'past'
  notes TEXT,
  -- Designated approver who owns approvals for this client's actions. Placeholder
  -- for future role-based approval routing (e.g. the PSRx clinic manager approves
  -- PSRx actions, not Blue). Field only — routing is built later.
  approver_name TEXT,
  approver_email TEXT,
  approver_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sites and deals roll up to a client; discovery notes inherit via their deal.
ALTER TABLE janet_sites ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES janet_clients(id) ON DELETE SET NULL;
ALTER TABLE janet_deals ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES janet_clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS janet_sites_client_idx ON janet_sites (client_id);
CREATE INDEX IF NOT EXISTS janet_deals_client_idx ON janet_deals (client_id);
