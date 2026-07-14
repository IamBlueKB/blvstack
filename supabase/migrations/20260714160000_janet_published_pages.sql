-- JANET Published proposals (Feature 3) — a proposal doc can go live at
-- blvstack.com/[slug], rendered through a premium template. noindex by default
-- (client-specific). Every view reports back: opened, when, how long, and which
-- sections got attention — the sales signal that feeds the ledger.

create table if not exists janet_published_pages (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references janet_docs(id) on delete cascade,
  slug text not null unique,                 -- 'aurora-refresh'
  published boolean not null default false,
  indexable boolean not null default false,  -- noindex by default
  template text default 'proposal',
  published_at timestamptz,
  unpublished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists janet_published_pages_doc_idx on janet_published_pages (doc_id);

create table if not exists janet_page_views (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references janet_published_pages(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  duration_seconds int,
  section_engagement jsonb,                  -- { "pricing": 240, "scope": 90 }
  referrer text,
  user_agent text
);
create index if not exists janet_page_views_page_idx on janet_page_views (page_id, viewed_at desc);
