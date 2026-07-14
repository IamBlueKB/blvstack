-- JANET The Doc (Feature 2) — a full-page AI writing workspace. Docs are block-
-- based, optionally scoped to a client, and linked into the accountability system
-- (a proposal belongs to a deal; a campaign doc to a recommendation). Version
-- history is required: every AI edit snapshots the prior state first.

create table if not exists janet_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_id uuid references janet_clients(id),                 -- NULL = standalone
  deal_id uuid references janet_deals(id),                     -- a proposal belongs to a deal
  recommendation_id uuid references janet_recommendations(id), -- a deliverable from an opportunity
  doc_type text,                                               -- proposal | scope | campaign | protocol | brief | notes | general
  content jsonb not null default '[]'::jsonb,                  -- block-based
  status text not null default 'active',                       -- 'active' | 'archived'
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists janet_docs_client_idx on janet_docs (client_id, status);
create index if not exists janet_docs_deal_idx on janet_docs (deal_id);

-- Each doc has its own doc-aware chat thread (created lazily). Memory is still
-- shared across every thread; this just keeps the doc's conversation returnable.
alter table janet_docs add column if not exists thread_id uuid references janet_threads(id);

-- Version history — restore any prior state. AI edits snapshot before writing.
create table if not exists janet_doc_versions (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references janet_docs(id) on delete cascade,
  content jsonb not null,
  label text,                                                  -- 'before JANET rewrite' | 'manual save' | ...
  created_by text,                                             -- 'blue' | 'janet'
  created_at timestamptz not null default now()
);
create index if not exists janet_doc_versions_doc_idx on janet_doc_versions (doc_id, created_at desc);

-- Saved templates — Blue can save any doc as a reusable template.
create table if not exists janet_doc_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  doc_type text,
  content jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
