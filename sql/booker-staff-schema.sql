-- =============================================================================
-- BLVBooker — Staff / RBAC Schema (run AFTER booker-schema.sql)
-- =============================================================================
-- Adds staff accounts with role-based access so you can hire agents who each
-- work only their assigned artists. FULLY ADDITIVE — new tables only.
-- Reuses the existing HMAC session + bcrypt auth LIBRARY (no change to it).
--
-- Roles:
--   owner   — full access to everything in BLVBooker. (Your founder admin_users
--             session is also auto-treated as owner; you don't log in twice.)
--   manager — all artists/gigs/venues/matches + run scrapes/pitches.
--             No staff mgmt, no settings/sources, no payments/billing.
--   agent   — scoped to ASSIGNED artists only. Works their book end-to-end.
--             No other agents' artists, no payments, no staff/settings.
-- =============================================================================


-- =============================================================================
-- booker_staff — BLVBooker operators (you + hired agents)
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_staff (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),

  email          text UNIQUE NOT NULL,
  password_hash  text NOT NULL,             -- bcrypt 12 rounds (same lib as admin_users)
  name           text,

  role           text NOT NULL DEFAULT 'agent'
                   CHECK (role IN ('owner','manager','agent')),

  -- optional granular overrides; null = role governs. Reserved for future
  -- fine-grained toggles without a schema change. Example:
  --   {"can_view_payments": true, "can_edit_sources": false}
  permissions    jsonb,

  active          boolean NOT NULL DEFAULT true,   -- disable without deleting
  last_login_at   timestamptz,
  deleted_at      timestamptz                      -- soft-delete (convention)
);

CREATE INDEX IF NOT EXISTS idx_booker_staff_email   ON booker_staff(email);
CREATE INDEX IF NOT EXISTS idx_booker_staff_role    ON booker_staff(role);
CREATE INDEX IF NOT EXISTS idx_booker_staff_active  ON booker_staff(active);

ALTER TABLE booker_staff ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_staff_assignments — which artists an agent manages (many-to-many)
-- Owners/managers see all; agents see only artists assigned here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_staff_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),

  staff_id    uuid NOT NULL REFERENCES booker_staff(id)   ON DELETE CASCADE,
  artist_id   uuid NOT NULL REFERENCES booker_artists(id) ON DELETE CASCADE,

  UNIQUE (staff_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_booker_staff_assign_staff  ON booker_staff_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_booker_staff_assign_artist ON booker_staff_assignments(artist_id);

ALTER TABLE booker_staff_assignments ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- OPTIONAL: staff password reset / invite tokens.
-- Mirrors the existing admin_reset_tokens pattern. Enable if you want an
-- invite-by-email flow; otherwise the owner sets staff passwords directly.
-- =============================================================================
-- CREATE TABLE IF NOT EXISTS booker_staff_reset_tokens (
--   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   email       text NOT NULL,
--   token_hash  text NOT NULL,
--   expires_at  timestamptz NOT NULL,
--   used_at     timestamptz,
--   created_at  timestamptz NOT NULL DEFAULT now()
-- );
-- ALTER TABLE booker_staff_reset_tokens ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- END BLVBooker staff schema
-- =============================================================================
