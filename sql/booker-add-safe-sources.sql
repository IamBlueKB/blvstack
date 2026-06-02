-- =============================================================================
-- BLVBooker — Safe scrape sources
-- All sources here either explicitly allow read access (Reddit RSS feeds are
-- publicly published by Reddit) or have no anti-scraping clause and no API.
-- source_type uses 'other' (existing enum value) to avoid schema changes.
-- ON CONFLICT (url) DO NOTHING makes this file safe to re-run.
-- =============================================================================

INSERT INTO booker_sources (vertical, source_type, label, url, city, region, active, notes) VALUES

-- ─── Reddit RSS — general gig boards (any vertical) ──────────────────────────
('any', 'other', 'Reddit r/forhire',     'https://old.reddit.com/r/forhire/new/.rss',    NULL, NULL, true, 'Public RSS. Gigs of all kinds.'),
('any', 'other', 'Reddit r/gigs',        'https://old.reddit.com/r/gigs/new/.rss',       NULL, NULL, true, 'Public RSS.'),
('any', 'other', 'Reddit r/openmics',    'https://old.reddit.com/r/openmics/new/.rss',   NULL, NULL, true, 'Open mic listings.'),

-- ─── Reddit RSS — music verticals ────────────────────────────────────────────
-- Bandmembers covers both musician + band; tagged 'any' so both verticals pick it up.
('any',      'other', 'Reddit r/Bandmembers',         'https://old.reddit.com/r/Bandmembers/new/.rss',         NULL, NULL, true, 'Band/musician gigs.'),
('musician', 'other', 'Reddit r/WeAreTheMusicMakers', 'https://old.reddit.com/r/WeAreTheMusicMakers/new/.rss', NULL, NULL, true, 'Music community; occasional gig posts.'),
('dj',       'other', 'Reddit r/DJs',                 'https://old.reddit.com/r/DJs/new/.rss',                 NULL, NULL, true, 'DJ gigs + community.'),
('dj',       'other', 'Reddit r/DJsForHire',          'https://old.reddit.com/r/DJsForHire/new/.rss',          NULL, NULL, true, 'DJ-specific board.'),

-- ─── Reddit RSS — poetry / spoken word ───────────────────────────────────────
('poet', 'other', 'Reddit r/Poetry',     'https://old.reddit.com/r/Poetry/new/.rss',     NULL, NULL, true, 'Poetry events + readings.'),
('poet', 'other', 'Reddit r/PoetrySlam', 'https://old.reddit.com/r/PoetrySlam/new/.rss', NULL, NULL, true, 'Slam events.'),
('poet', 'other', 'Reddit r/spokenword', 'https://old.reddit.com/r/spokenword/new/.rss', NULL, NULL, true, 'Spoken word events.'),

-- ─── Reddit RSS — visual artists ─────────────────────────────────────────────
('visual_artist', 'other', 'Reddit r/ArtistLounge',   'https://old.reddit.com/r/ArtistLounge/new/.rss',   NULL, NULL, true, 'Artist opportunities.'),
('visual_artist', 'other', 'Reddit r/ArtBusiness',    'https://old.reddit.com/r/ArtBusiness/new/.rss',    NULL, NULL, true, 'Art-business calls + opps.'),
('visual_artist', 'other', 'Reddit r/forhireartists', 'https://old.reddit.com/r/forhireartists/new/.rss', NULL, NULL, true, 'Visual artists for hire.'),

-- ─── Rapper / hip-hop ────────────────────────────────────────────────────────
('rapper', 'other', 'Reddit r/makinghiphop', 'https://old.reddit.com/r/makinghiphop/new/.rss', NULL, NULL, true, 'Hip-hop creator community + occasional gigs.'),
('rapper', 'other', 'Reddit r/HipHopGigs',   'https://old.reddit.com/r/HipHopGigs/new/.rss',   NULL, NULL, true, 'Hip-hop gig board.'),

-- ─── Singer ──────────────────────────────────────────────────────────────────
('singer', 'other', 'Reddit r/singing', 'https://old.reddit.com/r/singing/new/.rss', NULL, NULL, true, 'Singer community + occasional gigs.'),

-- ─── Poets & Writers Classifieds ─────────────────────────────────────────────
('poet', 'other', 'Poets & Writers Classifieds', 'https://www.pw.org/classifieds', NULL, NULL, true, 'Public listings; readings, residencies, calls.'),

-- ─── CaFÉ — Call For Entry (visual artist calls) ─────────────────────────────
('visual_artist', 'other', 'CaFÉ — Open Calls', 'https://www.callforentry.org/festivals_unique_info.php', NULL, NULL, true, 'Open visual-artist calls; exhibitions + festivals.')

ON CONFLICT (url) DO NOTHING;

-- Sanity check
SELECT vertical, COUNT(*) FROM booker_sources WHERE active = true GROUP BY vertical ORDER BY vertical;
