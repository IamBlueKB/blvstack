-- JANET Phase 4B — her own PSRx do-not-contact / exclusion list (BLVSTACK-side).
-- The opt-out safety net: PSRx has no lead-level opt-out in its DB, so JANET keeps
-- this list. The nurture engine refuses anyone here; the snapshot excludes them from
-- real counts. Seeded with known test/self identities (Blue's own test rows) and
-- grown when a lead opts out or the clinic manager rejects with "do not contact".

create table if not exists janet_psrx_suppression (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid,                 -- PSRx assessment_leads id (optional)
  email text,                   -- suppress by email (robust across duplicate rows)
  reason text not null,         -- 'test/self' | 'opted out' | 'manager: do not contact' | ...
  created_at timestamptz not null default now(),
  created_by text default 'janet'
);
create index if not exists janet_psrx_suppression_email_idx on janet_psrx_suppression (lower(email));
create index if not exists janet_psrx_suppression_lead_idx on janet_psrx_suppression (lead_id);
