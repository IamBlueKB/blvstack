-- Clear Ear Studios - reversibility (Bug 1). Every financial write gets a defined
-- reversal path. Voiding an invoice PRESERVES it (numbering + audit trail intact)
-- and soft-voids its payments rather than deleting them, so "what happened" is
-- always recoverable from the rows.

ALTER TABLE clearear_invoices
  ADD COLUMN IF NOT EXISTS voided_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE clearear_payments
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Voided payments must never count as collected revenue.
CREATE INDEX IF NOT EXISTS clearear_payments_live_idx ON clearear_payments (invoice_id) WHERE voided_at IS NULL;
