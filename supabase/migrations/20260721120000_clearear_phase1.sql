-- Clear Ear Studio - Phase 1: Contacts, Services, Sessions.
-- Blue's studio business, its own admin section (separate from BLVSTACK client
-- work). JANET is the conversational interface. Stripe/invoicing come later.
--
-- All three tables are RLS-locked (enable + no policy => anon/authenticated
-- read nothing; the service role bypasses). They hold contact PII + money.

-- 1.1 Contacts - full record, not just a name on a payment.
CREATE TABLE IF NOT EXISTS clearear_contacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           TEXT NOT NULL DEFAULT 'individual',   -- 'individual' | 'organization'
  name           TEXT NOT NULL,                        -- person or org name
  contact_person TEXT,                                 -- for orgs: who to address
  email          TEXT,
  phone          TEXT,
  socials        JSONB DEFAULT '{}'::jsonb,            -- { instagram, x, tiktok, youtube, soundcloud, spotify, ... }
  address        JSONB,                                -- orgs need this on invoices
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'archived'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clearear_contacts_status_idx ON clearear_contacts (status);
CREATE INDEX IF NOT EXISTS clearear_contacts_name_idx ON clearear_contacts (lower(name));

-- 1.2 Service catalog - configurable, Blue edits/adds from the UI.
CREATE TABLE IF NOT EXISTS clearear_services (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  billing_type TEXT NOT NULL,                          -- 'hourly' | 'flat' | 'custom'
  default_rate NUMERIC(10,2),                          -- hourly rate or flat price; nullable for custom
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 Sessions. invoice_id is a plain UUID for now - the FK to clearear_invoices
-- is added in Phase 2 when that table exists. service_label + rate are SNAPSHOTS
-- so later catalog edits can't rewrite history.
CREATE TABLE IF NOT EXISTS clearear_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES clearear_contacts(id),
  service_id    UUID REFERENCES clearear_services(id),
  service_label TEXT,                                  -- snapshot of the service name at session time
  session_date  DATE NOT NULL,
  start_time    TIME,
  hours         NUMERIC(5,2),                          -- for hourly services
  rate          NUMERIC(10,2),                         -- rate applied (may differ from default)
  amount        NUMERIC(10,2) NOT NULL,                -- what it came to
  notes         TEXT,
  invoice_id    UUID,                                  -- FK added in Phase 2 (clearear_invoices)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clearear_sessions_contact_idx ON clearear_sessions (contact_id, session_date DESC);
CREATE INDEX IF NOT EXISTS clearear_sessions_date_idx ON clearear_sessions (session_date DESC);
CREATE INDEX IF NOT EXISTS clearear_sessions_uninvoiced_idx ON clearear_sessions (contact_id) WHERE invoice_id IS NULL;

-- Seed the starter catalog (idempotent by name). Rates left NULL - Blue sets them;
-- we never invent an amount.
INSERT INTO clearear_services (name, billing_type, sort_order)
SELECT v.name, v.billing_type, v.sort_order
FROM (VALUES
  ('Studio Time', 'hourly', 1),
  ('Music Production', 'flat', 2),
  ('Youth Audio Program', 'custom', 3),
  ('Mixing', 'flat', 4),
  ('Mastering', 'flat', 5)
) AS v(name, billing_type, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM clearear_services s WHERE s.name = v.name);

ALTER TABLE clearear_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_sessions ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: RLS-on + no-policy blocks anon/authenticated entirely;
-- the app reaches these only through the service role (supabaseAdmin).
