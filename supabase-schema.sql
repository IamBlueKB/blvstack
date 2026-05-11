-- BLVSTACK Supabase Schema
-- Run this in the Supabase SQL editor after creating your project

-- Leads (apply form submissions)
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  phone text,
  business_name text,
  website_url text,
  revenue_range text,
  problem text,
  timeline text,
  budget_tier text,
  source text default 'apply_form',
  status text default 'new', -- new | qualified | call_booked | proposal_sent | won | lost | disqualified
  notes text,
  ip_address text
);

-- Agent conversations (homepage AI chat)
create table agent_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  session_id text not null,
  messages jsonb not null default '[]',
  lead_id uuid references leads(id),
  ip_address text,
  message_count int default 0
);

-- Contact messages (/contact form)
create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  message text not null,
  status text default 'new'
);

-- Enable RLS on all tables
alter table leads enable row level security;
alter table agent_conversations enable row level security;
alter table contact_messages enable row level security;

-- Service role bypass (for server-side inserts only)
create policy "Service role full access" on leads
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on agent_conversations
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on contact_messages
  for all using (auth.role() = 'service_role');

-- No public read access on any table
