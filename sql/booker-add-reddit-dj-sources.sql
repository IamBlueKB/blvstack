-- Add Reddit subs targeted at DJ gig leads (Chicago artist focus).
-- All RSS feeds, public, no auth. Existing scraper handles RSS.
-- Run in Supabase SQL editor.

INSERT INTO booker_sources (vertical, source_type, label, url, city, region, active, notes) VALUES

-- Local Chicago — highest signal for djthanyouteddy
('dj', 'other', 'Reddit r/chicago',
  'https://www.reddit.com/r/chicago/new.rss',
  'Chicago', 'IL', true,
  'Local Chicago subreddit — people post DJ requests, party planning, venue questions'),

('dj', 'other', 'Reddit r/AskChicago',
  'https://www.reddit.com/r/AskChicago/new.rss',
  'Chicago', 'IL', true,
  'Chicago Q&A sub — recurring "any good DJ in Chicago for..." threads'),

('dj', 'other', 'Reddit r/ChicagoSuburbs',
  'https://www.reddit.com/r/ChicagoSuburbs/new.rss',
  'Chicago', 'IL', true,
  'Suburban Chicago — wedding venues + party hosts who travel-in DJs'),

-- Wedding-focused, city-agnostic. Matcher will filter to Chicago metro by city/region.
('dj', 'other', 'Reddit r/WeddingPlanning',
  'https://www.reddit.com/r/WeddingPlanning/new.rss',
  NULL, NULL, true,
  '800k+ members. Couples actively planning weddings, often asking for DJ recs/vendors'),

('dj', 'other', 'Reddit r/Weddings',
  'https://www.reddit.com/r/Weddings/new.rss',
  NULL, NULL, true,
  '1M+ members. Higher volume, more general — DJ-related posts mixed with dress/decor noise'),

-- Event-industry / DJ community — lower volume but high intent when posts hit
('dj', 'other', 'Reddit r/EventPlanners',
  'https://www.reddit.com/r/EventPlanners/new.rss',
  NULL, NULL, true,
  'Event planning pros — sometimes sourcing DJ vendors for clients'),

('dj', 'other', 'Reddit r/Beatmatch',
  'https://www.reddit.com/r/Beatmatch/new.rss',
  NULL, NULL, true,
  'DJ community sub — gig opportunities posted occasionally')

-- ON CONFLICT (url) DO NOTHING in case some are already in the table
ON CONFLICT (url) DO NOTHING;

-- Verify insertion
SELECT label, url, city, active FROM booker_sources
WHERE label LIKE 'Reddit r/%'
ORDER BY city NULLS LAST, label;
