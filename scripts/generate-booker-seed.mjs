// Generate sql/booker-sources-seed.sql with comprehensive scrape sources.
// Run with: node scripts/generate-booker-seed.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── 40 top US Craigslist metros ──────────────────────────────────
const CITIES = [
  { sub: 'newyork',       city: 'New York',       region: 'NY' },
  { sub: 'losangeles',    city: 'Los Angeles',    region: 'CA' },
  { sub: 'chicago',       city: 'Chicago',        region: 'IL' },
  { sub: 'dallas',        city: 'Dallas',         region: 'TX' },
  { sub: 'houston',       city: 'Houston',        region: 'TX' },
  { sub: 'washingtondc',  city: 'Washington',     region: 'DC' },
  { sub: 'miami',         city: 'Miami',          region: 'FL' },
  { sub: 'philadelphia',  city: 'Philadelphia',   region: 'PA' },
  { sub: 'atlanta',       city: 'Atlanta',        region: 'GA' },
  { sub: 'boston',        city: 'Boston',         region: 'MA' },
  { sub: 'sfbay',         city: 'San Francisco',  region: 'CA' },
  { sub: 'phoenix',       city: 'Phoenix',        region: 'AZ' },
  { sub: 'detroit',       city: 'Detroit',        region: 'MI' },
  { sub: 'seattle',       city: 'Seattle',        region: 'WA' },
  { sub: 'minneapolis',   city: 'Minneapolis',    region: 'MN' },
  { sub: 'sandiego',      city: 'San Diego',      region: 'CA' },
  { sub: 'tampa',         city: 'Tampa',          region: 'FL' },
  { sub: 'denver',        city: 'Denver',         region: 'CO' },
  { sub: 'baltimore',     city: 'Baltimore',      region: 'MD' },
  { sub: 'stlouis',       city: 'St. Louis',      region: 'MO' },
  { sub: 'orlando',       city: 'Orlando',        region: 'FL' },
  { sub: 'portland',      city: 'Portland',       region: 'OR' },
  { sub: 'charlotte',     city: 'Charlotte',      region: 'NC' },
  { sub: 'sanantonio',    city: 'San Antonio',    region: 'TX' },
  { sub: 'austin',        city: 'Austin',         region: 'TX' },
  { sub: 'sacramento',    city: 'Sacramento',     region: 'CA' },
  { sub: 'pittsburgh',    city: 'Pittsburgh',     region: 'PA' },
  { sub: 'cincinnati',    city: 'Cincinnati',     region: 'OH' },
  { sub: 'lasvegas',      city: 'Las Vegas',      region: 'NV' },
  { sub: 'kansascity',    city: 'Kansas City',    region: 'MO' },
  { sub: 'cleveland',     city: 'Cleveland',      region: 'OH' },
  { sub: 'columbus',      city: 'Columbus',       region: 'OH' },
  { sub: 'indianapolis',  city: 'Indianapolis',   region: 'IN' },
  { sub: 'nashville',     city: 'Nashville',      region: 'TN' },
  { sub: 'milwaukee',     city: 'Milwaukee',      region: 'WI' },
  { sub: 'raleigh',       city: 'Raleigh',        region: 'NC' },
  { sub: 'neworleans',    city: 'New Orleans',    region: 'LA' },
  { sub: 'memphis',       city: 'Memphis',        region: 'TN' },
  { sub: 'louisville',    city: 'Louisville',     region: 'KY' },
  { sub: 'richmond',      city: 'Richmond',       region: 'VA' },
];

// ─── Craigslist sub-sections ──────────────────────────────────────
const CL_SECTIONS = [
  { code: 'evg', name: 'event-gigs',    vertical: 'any',           label: 'Event gigs' },
  { code: 'tlg', name: 'talent-gigs',   vertical: 'any',           label: 'Talent gigs' },
  { code: 'crg', name: 'creative-gigs', vertical: 'visual_artist', label: 'Creative gigs' },
  { code: 'wrg', name: 'writing-gigs',  vertical: 'poet',          label: 'Writing gigs' },
];

// ─── Indeed search keywords → vertical mapping ────────────────────
const INDEED_QUERIES = [
  { q: 'musician wanted',   vertical: 'musician' },
  { q: 'DJ wanted',         vertical: 'dj' },
  { q: 'band wanted',       vertical: 'band' },
  { q: 'singer wanted',     vertical: 'singer' },
  { q: 'rapper wanted',     vertical: 'rapper' },
  { q: 'performer wanted',  vertical: 'any' },
];

// ─── Reddit city subreddits (best-effort common names) ────────────
const REDDIT_CITIES = [
  { city: 'New York',       sub: 'nyc' },
  { city: 'Los Angeles',    sub: 'LosAngeles' },
  { city: 'Chicago',        sub: 'chicago' },
  { city: 'Dallas',         sub: 'Dallas' },
  { city: 'Houston',        sub: 'houston' },
  { city: 'Washington DC',  sub: 'washingtondc' },
  { city: 'Miami',          sub: 'Miami' },
  { city: 'Philadelphia',   sub: 'philadelphia' },
  { city: 'Atlanta',        sub: 'Atlanta' },
  { city: 'Boston',         sub: 'boston' },
  { city: 'San Francisco',  sub: 'sanfrancisco' },
  { city: 'Phoenix',        sub: 'phoenix' },
  { city: 'Detroit',        sub: 'Detroit' },
  { city: 'Seattle',        sub: 'Seattle' },
  { city: 'Minneapolis',    sub: 'minnesota' },
  { city: 'San Diego',      sub: 'sandiego' },
  { city: 'Tampa',          sub: 'tampa' },
  { city: 'Denver',         sub: 'Denver' },
  { city: 'Baltimore',      sub: 'baltimore' },
  { city: 'St. Louis',      sub: 'StLouis' },
  { city: 'Orlando',        sub: 'orlando' },
  { city: 'Portland',       sub: 'Portland' },
  { city: 'Charlotte',      sub: 'Charlotte' },
  { city: 'San Antonio',    sub: 'sanantonio' },
  { city: 'Austin',         sub: 'Austin' },
  { city: 'Sacramento',     sub: 'Sacramento' },
  { city: 'Pittsburgh',     sub: 'pittsburgh' },
  { city: 'Cincinnati',     sub: 'cincinnati' },
  { city: 'Las Vegas',      sub: 'vegas' },
  { city: 'Kansas City',    sub: 'kansascity' },
  { city: 'Cleveland',      sub: 'Cleveland' },
  { city: 'Columbus',       sub: 'Columbus' },
  { city: 'Indianapolis',   sub: 'indianapolis' },
  { city: 'Nashville',      sub: 'nashville' },
  { city: 'Milwaukee',      sub: 'milwaukee' },
  { city: 'Raleigh',        sub: 'raleigh' },
  { city: 'New Orleans',    sub: 'NewOrleans' },
  { city: 'Memphis',        sub: 'memphis' },
  { city: 'Louisville',     sub: 'Louisville' },
  { city: 'Richmond',       sub: 'rva' },
];

// Reddit search query — broad enough to catch all performer asks
const REDDIT_QUERY = encodeURIComponent('musician OR DJ OR band OR singer OR rapper OR poet wanted OR needed');

// ─── Backstage open-call categories ───────────────────────────────
const BACKSTAGE_SOURCES = [
  { vertical: 'musician', url: 'https://www.backstage.com/casting/musicians/',        label: 'Backstage — Musicians casting calls' },
  { vertical: 'singer',   url: 'https://www.backstage.com/casting/singers/',          label: 'Backstage — Singers casting calls' },
  { vertical: 'any',      url: 'https://www.backstage.com/casting/performers/',       label: 'Backstage — Performers casting calls' },
];

// ─── Poetry / spoken-word aggregators ─────────────────────────────
const POETRY_SOURCES = [
  { url: 'https://poets.org/events',                                label: 'Poets.org events' },
  { url: 'https://www.poetryfoundation.org/events',                 label: 'Poetry Foundation events' },
  { url: 'https://www.nuyorican.org/poetry/',                       label: 'Nuyorican Poets Cafe (NYC)' },
  { url: 'https://urbanwordnyc.org/programs/',                      label: 'Urban Word NYC programs' },
  { url: 'https://www.poetryslam.com/calendar/',                    label: 'Poetry Slam Inc. calendar' },
];

// ─── Festival aggregators ─────────────────────────────────────────
const FESTIVAL_SOURCES = [
  { vertical: 'any',     url: 'https://festivalnet.com/festivals/seeking/Bands-Musicians',  label: 'FestivalNet — Seeking bands & musicians' },
  { vertical: 'any',     url: 'https://festivalnet.com/festivals/seeking/Performers',       label: 'FestivalNet — Seeking performers' },
];

// ─── Build SQL ────────────────────────────────────────────────────
function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function row(vertical, source_type, label, url, city = null, region = null, notes = null) {
  return `(${esc(vertical)}, ${esc(source_type)}, ${esc(label)}, ${esc(url)}, ${esc(city)}, ${esc(region)}, true, ${esc(notes)})`;
}

const rows = [];

// Craigslist: 40 cities × 4 sections = 160
for (const c of CITIES) {
  for (const s of CL_SECTIONS) {
    const url = `https://${c.sub}.craigslist.org/d/${s.name}/search/${s.code}`;
    const label = `Craigslist ${c.city} — ${s.label}`;
    rows.push(row(s.vertical, 'craigslist', label, url, c.city, c.region));
  }
}

// Indeed: 40 cities × 6 keywords = 240
for (const c of CITIES) {
  const l = encodeURIComponent(`${c.city}, ${c.region}`);
  for (const q of INDEED_QUERIES) {
    const qEnc = encodeURIComponent(q.q);
    const url = `https://www.indeed.com/jobs?q=${qEnc}&l=${l}`;
    const label = `Indeed ${c.city} — ${q.q}`;
    rows.push(row(q.vertical, 'other', label, url, c.city, c.region, 'Indeed job board search'));
  }
}

// Reddit: 40 city subreddits, vertical 'any'
for (const r of REDDIT_CITIES) {
  const url = `https://www.reddit.com/r/${r.sub}/search.json?q=${REDDIT_QUERY}&restrict_sr=on&sort=new&t=month`;
  const label = `Reddit r/${r.sub} — gigs search`;
  // Find region from CITIES list by city match
  const cityRow = CITIES.find((c) => c.city === r.city);
  rows.push(row('any', 'other', label, url, r.city, cityRow?.region ?? null, 'Reddit JSON feed'));
}

// Backstage
for (const b of BACKSTAGE_SOURCES) {
  rows.push(row(b.vertical, 'other', b.label, b.url, null, null, 'Backstage casting calls'));
}

// Poetry aggregators
for (const p of POETRY_SOURCES) {
  rows.push(row('poet', 'calendar', p.label, p.url, null, null, 'Poetry/spoken-word aggregator'));
}

// Festivals
for (const f of FESTIVAL_SOURCES) {
  rows.push(row(f.vertical, 'other', f.label, f.url, null, null, 'Festival aggregator'));
}

const totalCount = rows.length;

const sql = `-- =============================================================================
-- BLVBooker — Seed booker_sources comprehensively
-- =============================================================================
-- Run AFTER booker-schema.sql AND booker-verticals-expand.sql.
-- Idempotent — uses ON CONFLICT (url) DO NOTHING. Re-running is safe.
-- =============================================================================

-- Add unique constraint on url so we can upsert idempotently (safe if rerun).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booker_sources_url_uniq'
  ) THEN
    ALTER TABLE booker_sources ADD CONSTRAINT booker_sources_url_uniq UNIQUE (url);
  END IF;
END $$;

INSERT INTO booker_sources (vertical, source_type, label, url, city, region, active, notes) VALUES
${rows.join(',\n')}
ON CONFLICT (url) DO NOTHING;

-- =============================================================================
-- END seed (${totalCount} sources)
-- =============================================================================
`;

const outPath = 'sql/booker-sources-seed.sql';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, sql);
console.log(`Wrote ${outPath} with ${totalCount} sources`);
