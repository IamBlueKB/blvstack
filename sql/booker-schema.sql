-- =============================================================================
-- BLVBooker — Schema Migration
-- =============================================================================
-- A separate arm of the BLVSTACK admin panel. FULLY ADDITIVE.
-- Creates only new `booker_`-prefixed tables. Does NOT alter or touch any
-- existing table (leads, prospects, outbound_emails, etc.).
-- Safe to run on the live database.
--
-- Conventions mirror the existing panel:
--   - uuid PK default gen_random_uuid()
--   - created_at timestamptz default now()
--   - soft-delete via nullable deleted_at
--   - status enums as CHECK constraints on text (not Postgres enums)
--   - RLS enabled, service role only, no public policies
--   - indexes named idx_<table>_<col>
--
-- Money note: all amounts are WHOLE DOLLARS (integer) for manual tracking.
-- When Stripe wires in, add a *_cents column or migrate; not needed now.
-- =============================================================================


-- =============================================================================
-- booker_artists — the roster. Target of the tokenized intake form.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_artists (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- tokenized intake link (you generate, send via email/SMS; OG-imaged page)
  intake_token        text UNIQUE NOT NULL,
  intake_sent_at      timestamptz,
  intake_completed_at timestamptz,

  -- identity
  name                text,
  stage_name          text,
  email               text,
  phone               text,

  -- profile (drives matching)
  performer_type      text CHECK (performer_type IN
                        ('dj','musician','poet','visual_artist','band','other')),
  genres              text,                 -- freeform: "house, techno" / "spoken word"
  city                text,
  region              text,                 -- state/province
  travel_radius_mi    integer,
  rate_floor          integer,              -- min acceptable gig pay, whole $
  rate_notes          text,
  gig_types           text[],               -- {weddings,clubs,corporate,private,
                                            --  festivals,open_mics,college,restaurants}
  availability_notes  text,
  bio                 text,
  press_kit_url       text,
  demo_url            text,
  social_links        jsonb,                -- {instagram, soundcloud, spotify, ...}
  hard_nos            text,                 -- won't play X, won't travel past Y

  -- relationship + billing (what THEY pay YOU)
  status              text NOT NULL DEFAULT 'prospect'
                        CHECK (status IN
                        ('prospect','onboarding','active','paused','churned')),
  monthly_rate        integer,              -- retainer $/mo
  success_fee_pct     numeric(5,2),         -- % of booked gig fee

  notes               text,
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_booker_artists_status      ON booker_artists(status);
CREATE INDEX IF NOT EXISTS idx_booker_artists_deleted_at  ON booker_artists(deleted_at);
CREATE INDEX IF NOT EXISTS idx_booker_artists_created_at  ON booker_artists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booker_artists_intake_token ON booker_artists(intake_token);
CREATE INDEX IF NOT EXISTS idx_booker_artists_performer_type ON booker_artists(performer_type);

ALTER TABLE booker_artists ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_sources — per-vertical scrape targets (Build A: public postings).
-- Pick a vertical in the UI → run only its active sources.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_sources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  vertical           text NOT NULL CHECK (vertical IN
                       ('dj','musician','poet','visual_artist','band','any')),
  source_type        text NOT NULL CHECK (source_type IN
                       ('craigslist','eventbrite','patch','calendar','other')),
  label              text NOT NULL,         -- "Chicago CL /gigs", "NJ Poetry Events"
  url                text NOT NULL,
  city               text,
  region             text,

  active             boolean NOT NULL DEFAULT true,
  last_scraped_at    timestamptz,
  last_result_count  integer,
  notes              text
);

CREATE INDEX IF NOT EXISTS idx_booker_sources_vertical ON booker_sources(vertical);
CREATE INDEX IF NOT EXISTS idx_booker_sources_active   ON booker_sources(active);

ALTER TABLE booker_sources ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_venues — venue DB (Build B: outbound pitch engine).
-- Seeded from venue databases + Google Places. The "prospect" of the gig side.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_venues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  name            text NOT NULL,
  venue_type      text CHECK (venue_type IN
                    ('bar','club','festival','library','college','coffeehouse',
                     'theater','restaurant','private_events','corporate','gallery','other')),
  city            text,
  region          text,
  address         text,

  website_url     text,
  booking_url     text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,

  verticals       text[],                   -- which performer types this venue books
  genres_pref     text,
  capacity        integer,

  source          text CHECK (source IN
                    ('google_places','indie_on_the_move','manual','scrape')),
  source_url      text,
  ai_research     jsonb,                    -- pain/angle/booking hints

  status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN
                    ('new','researched','contacted','responsive','booked','dead','suppressed')),
  notes           text,
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_booker_venues_status     ON booker_venues(status);
CREATE INDEX IF NOT EXISTS idx_booker_venues_city       ON booker_venues(city);
CREATE INDEX IF NOT EXISTS idx_booker_venues_deleted_at ON booker_venues(deleted_at);
CREATE INDEX IF NOT EXISTS idx_booker_venues_contact_email ON booker_venues(contact_email);

ALTER TABLE booker_venues ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_gigs — scraped opportunities (Build A output).
-- Explicit "performer wanted" postings, normalized by AI.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_gigs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),

  source         text CHECK (source IN
                   ('craigslist','eventbrite','patch','calendar','manual','venue')),
  source_url     text,
  source_id      uuid REFERENCES booker_sources(id) ON DELETE SET NULL,

  vertical       text CHECK (vertical IN
                   ('dj','musician','poet','visual_artist','band','any')),
  title          text,
  venue_name     text,
  city           text,
  region         text,
  gig_date       date,
  pay_text       text,                      -- raw, e.g. "$300 + tips"
  pay_amount     integer,                   -- parsed whole $ when possible
  requirements   text,
  contact_email  text,
  contact_method text,                      -- how to respond if not email

  raw_text       text NOT NULL,             -- original scraped content
  ai_normalized  jsonb,                     -- structured extraction

  status         text NOT NULL DEFAULT 'new'
                   CHECK (status IN
                   ('new','normalized','matched','sent','expired','dead')),
  deleted_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_booker_gigs_status     ON booker_gigs(status);
CREATE INDEX IF NOT EXISTS idx_booker_gigs_vertical   ON booker_gigs(vertical);
CREATE INDEX IF NOT EXISTS idx_booker_gigs_gig_date   ON booker_gigs(gig_date);
CREATE INDEX IF NOT EXISTS idx_booker_gigs_deleted_at ON booker_gigs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_booker_gigs_created_at ON booker_gigs(created_at DESC);

ALTER TABLE booker_gigs ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_matches — the curation layer. The heart of BLVBooker.
-- Links an artist to either a scraped gig (Build A) or a venue (Build B),
-- carries the AI score + reasoning, the draft, and the booking lifecycle.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  artist_id          uuid NOT NULL REFERENCES booker_artists(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('gig','venue')),
  gig_id             uuid REFERENCES booker_gigs(id)   ON DELETE CASCADE,
  venue_id           uuid REFERENCES booker_venues(id) ON DELETE CASCADE,

  -- enforce that the right reference is present for the kind
  CONSTRAINT booker_matches_ref_ck CHECK (
    (kind = 'gig'   AND gig_id   IS NOT NULL) OR
    (kind = 'venue' AND venue_id IS NOT NULL)
  ),

  score              integer CHECK (score BETWEEN 0 AND 100),
  reasoning          text,                  -- one-line AI fit rationale

  -- the draft (to the artist for a gig; the pitch to the venue for Build B)
  draft_subject      text,
  draft_body         text,

  status             text NOT NULL DEFAULT 'suggested'
                       CHECK (status IN
                       ('suggested','drafted','sent_to_artist','artist_approved',
                        'pitched','interested','booked','passed','dead')),

  sent_to_artist_at  timestamptz,
  pitched_at         timestamptz,
  booked_at          timestamptz,
  booked_amount      integer,               -- final gig fee, whole $ (drives success fee)

  notes              text
);

CREATE INDEX IF NOT EXISTS idx_booker_matches_artist_id  ON booker_matches(artist_id);
CREATE INDEX IF NOT EXISTS idx_booker_matches_gig_id     ON booker_matches(gig_id);
CREATE INDEX IF NOT EXISTS idx_booker_matches_venue_id   ON booker_matches(venue_id);
CREATE INDEX IF NOT EXISTS idx_booker_matches_status     ON booker_matches(status);
CREATE INDEX IF NOT EXISTS idx_booker_matches_created_at ON booker_matches(created_at DESC);

ALTER TABLE booker_matches ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_outreach — log of every email sent (to artist or to venue).
-- Mirrors outbound_emails. FK cascade on match delete.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_outreach (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  match_id           uuid REFERENCES booker_matches(id) ON DELETE CASCADE,
  artist_id          uuid REFERENCES booker_artists(id) ON DELETE CASCADE,

  direction          text NOT NULL CHECK (direction IN ('to_artist','to_venue')),
  to_email           text NOT NULL,
  subject            text NOT NULL,
  body               text NOT NULL,

  resend_message_id  text,
  resend_thread_id   text,
  status             text NOT NULL DEFAULT 'sent'
                       CHECK (status IN ('sent','bounced','replied'))
);

CREATE INDEX IF NOT EXISTS idx_booker_outreach_match_id  ON booker_outreach(match_id);
CREATE INDEX IF NOT EXISTS idx_booker_outreach_artist_id ON booker_outreach(artist_id);

ALTER TABLE booker_outreach ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_payments — manual tracking now; Stripe wires in after proof of concept.
-- This is your MRR ledger.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),

  artist_id   uuid NOT NULL REFERENCES booker_artists(id) ON DELETE CASCADE,
  match_id    uuid REFERENCES booker_matches(id) ON DELETE SET NULL,

  type        text NOT NULL CHECK (type IN ('retainer','success_fee','setup')),
  amount      integer NOT NULL,             -- whole $
  period      text,                         -- retainer month, e.g. '2026-06'
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','paid','overdue','void')),
  method      text DEFAULT 'manual'         -- 'manual' now, 'stripe' later
                CHECK (method IN ('manual','stripe')),
  paid_at     timestamptz,
  notes       text
);

CREATE INDEX IF NOT EXISTS idx_booker_payments_artist_id ON booker_payments(artist_id);
CREATE INDEX IF NOT EXISTS idx_booker_payments_status    ON booker_payments(status);
CREATE INDEX IF NOT EXISTS idx_booker_payments_period    ON booker_payments(period);

ALTER TABLE booker_payments ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- booker_settings — key/value config. Mirrors outbound_settings.
-- =============================================================================
CREATE TABLE IF NOT EXISTS booker_settings (
  key    text PRIMARY KEY,
  value  text NOT NULL
);

ALTER TABLE booker_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO booker_settings (key, value) VALUES
  ('booker_from_email',       ''),          -- separate sender from clinic outbound
  ('booker_from_name',        'BLVBooker'),
  ('default_monthly_rate',    '149'),
  ('default_success_fee_pct', '12.5'),
  ('match_threshold',         '70'),        -- min score to surface a match
  ('venue_daily_cap',         '15'),        -- max venue pitches/day (Build B)
  ('artist_send_signature',   '')           -- signs gig-suggestion emails to artists
ON CONFLICT (key) DO NOTHING;


-- =============================================================================
-- OPTIONAL: auto-expire past-dated gigs. Requires pg_cron (already enabled).
-- Flips dated gigs to 'expired' daily at 04:00 UTC. Safe, additive.
-- Uncomment to enable.
-- =============================================================================
-- SELECT cron.schedule(
--   'booker-expire-gigs',
--   '0 4 * * *',
--   $$UPDATE booker_gigs
--       SET status = 'expired'
--     WHERE gig_date IS NOT NULL
--       AND gig_date < now()::date
--       AND status NOT IN ('expired','dead','sent')$$
-- );

-- =============================================================================
-- END BLVBooker schema
-- =============================================================================
