-- Clear Ear Studio - Phase 2: invoicing. Invoices + line items, a configurable
-- payment-method catalog (selectable per invoice), payments (partial/deposits,
-- and standalone with no invoice), recurring templates, and issuer settings.
-- Stripe is NOT here - it plugs in later as one more method writing
-- clearear_payments rows. All tables RLS-locked (service role only).

-- Recurring templates first (invoices reference them).
CREATE TABLE IF NOT EXISTS clearear_recurring (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES clearear_contacts(id),
  template        JSONB NOT NULL,                       -- { lines, payment_methods, notes, terms }
  frequency       TEXT NOT NULL,                        -- 'monthly' | 'weekly' | 'quarterly'
  next_issue_date DATE NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.1 Invoices.
CREATE TABLE IF NOT EXISTS clearear_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT NOT NULL UNIQUE,                 -- sequential: CE-2026-0001
  contact_id      UUID NOT NULL REFERENCES clearear_contacts(id),
  status          TEXT NOT NULL DEFAULT 'draft',        -- draft|sent|viewed|partial|paid|overdue|void
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2) DEFAULT 0,
  tax_amount      NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_methods TEXT[] NOT NULL DEFAULT '{}',         -- which method keys render on THIS invoice
  notes           TEXT,
  recurring_id    UUID REFERENCES clearear_recurring(id),
  view_token      TEXT UNIQUE,                          -- for the /i/[token] client view (Phase 2b)
  sent_at         TIMESTAMPTZ,
  viewed_at       TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clearear_invoices_contact_idx ON clearear_invoices (contact_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS clearear_invoices_status_idx ON clearear_invoices (status);

CREATE TABLE IF NOT EXISTS clearear_invoice_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES clearear_invoices(id) ON DELETE CASCADE,
  session_id    UUID REFERENCES clearear_sessions(id),   -- null for manual lines
  description   TEXT NOT NULL,
  service_label TEXT,                                    -- what it's FOR
  quantity      NUMERIC(10,2) DEFAULT 1,
  unit_price    NUMERIC(10,2) NOT NULL,
  amount        NUMERIC(10,2) NOT NULL,
  sort_order    INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS clearear_invoice_lines_invoice_idx ON clearear_invoice_lines (invoice_id, sort_order);

-- Now the sessions -> invoices FK deferred from Phase 1.
ALTER TABLE clearear_sessions
  ADD CONSTRAINT clearear_sessions_invoice_fk
  FOREIGN KEY (invoice_id) REFERENCES clearear_invoices(id) ON DELETE SET NULL;

-- 2.2 Payment methods - configurable; instructions render on the invoice.
CREATE TABLE IF NOT EXISTS clearear_payment_methods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT NOT NULL UNIQUE,                     -- cashapp|zelle|cash|check|ach|stripe
  label        TEXT NOT NULL,
  instructions TEXT,                                     -- Blue fills these in; we never invent his handles
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed the method keys/labels. instructions LEFT NULL on purpose - Blue sets his
-- real CashApp/Zelle/etc. details in settings; getting paid depends on that.
INSERT INTO clearear_payment_methods (key, label, sort_order)
SELECT v.key, v.label, v.sort_order
FROM (VALUES
  ('cashapp','Cash App',1),
  ('zelle','Zelle',2),
  ('cash','Cash',3),
  ('check','Check',4),
  ('ach','Bank Transfer (ACH)',5),
  ('stripe','Card / Online',6)
) AS v(key,label,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM clearear_payment_methods m WHERE m.key = v.key);

-- 2.3 Payments - many per invoice; can also stand alone (no invoice).
CREATE TABLE IF NOT EXISTS clearear_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID REFERENCES clearear_invoices(id) ON DELETE SET NULL,
  contact_id  UUID NOT NULL REFERENCES clearear_contacts(id),
  session_id  UUID REFERENCES clearear_sessions(id),
  amount      NUMERIC(10,2) NOT NULL,
  method      TEXT NOT NULL,                             -- cashapp|zelle|cash|check|ach|stripe|other
  paid_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  reference   TEXT,                                      -- check #, txn id, confirmation
  is_deposit  BOOLEAN DEFAULT false,
  notes       TEXT,
  recorded_by TEXT,                                      -- 'blue' | 'janet' | 'stripe_webhook'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clearear_payments_invoice_idx ON clearear_payments (invoice_id);
CREATE INDEX IF NOT EXISTS clearear_payments_contact_idx ON clearear_payments (contact_id, paid_at DESC);

-- 2.5 Issuer settings - single row. Blue fills these; they appear on invoices.
CREATE TABLE IF NOT EXISTS clearear_settings (
  id               INT PRIMARY KEY DEFAULT 1,
  business_name    TEXT,
  address          JSONB,
  email            TEXT,
  phone            TEXT,
  tax_id           TEXT,
  default_tax_rate NUMERIC(5,2) DEFAULT 0,
  default_terms    TEXT,
  default_notes    TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clearear_settings_singleton CHECK (id = 1)
);
INSERT INTO clearear_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Sequential, per-year, never-reused invoice numbers (atomic).
CREATE TABLE IF NOT EXISTS clearear_invoice_counters (
  year     INT PRIMARY KEY,
  last_seq INT NOT NULL DEFAULT 0
);
CREATE OR REPLACE FUNCTION next_clearear_invoice_number() RETURNS TEXT AS $$
DECLARE y INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT; s INT;
BEGIN
  INSERT INTO clearear_invoice_counters(year, last_seq) VALUES (y, 1)
  ON CONFLICT (year) DO UPDATE SET last_seq = clearear_invoice_counters.last_seq + 1
  RETURNING last_seq INTO s;
  RETURN 'CE-' || y::text || '-' || lpad(s::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

ALTER TABLE clearear_recurring ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearear_invoice_counters ENABLE ROW LEVEL SECURITY;
