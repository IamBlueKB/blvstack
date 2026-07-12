-- JANET pending Ring 3 approvals (v2 spec 1.1 — approvals must survive the session).
-- A proposal used to live only in the chat plan-card; closing the panel or a
-- dropped session lost it. Persisted here on emit, cleared on approve/reject, so
-- Blue can come back later and still act on it.
CREATE TABLE IF NOT EXISTS janet_pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposals JSONB NOT NULL,           -- [{ tool, input, summary }]
  summary TEXT,                        -- joined summaries for quick display
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  page_context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS janet_pending_approvals_status_idx ON janet_pending_approvals (status, created_at DESC);
