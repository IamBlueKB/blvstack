-- JANET threads (Feature 1) — client-scoped conversation threads. Multiple named
-- threads, each optionally attached to a client; switchable; nothing destroyed.
-- janet_memory stays shared across ALL threads (untouched here).

create table if not exists janet_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_id uuid references janet_clients(id),   -- NULL = standalone
  status text not null default 'active',         -- 'active' | 'archived'
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists janet_threads_client_idx on janet_threads (client_id, status);
create index if not exists janet_threads_recent_idx on janet_threads (last_message_at desc);

alter table janet_messages add column if not exists thread_id uuid references janet_threads(id);
create index if not exists janet_messages_thread_idx on janet_messages (thread_id, created_at);

-- Migrate: everything existing goes into a default "General" thread — lose nothing.
do $$
declare gen_id uuid;
begin
  select id into gen_id from janet_threads where title = 'General' and client_id is null limit 1;
  if gen_id is null then
    insert into janet_threads (title, last_message_at)
    values ('General', (select max(created_at) from janet_messages))
    returning id into gen_id;
  end if;
  update janet_messages set thread_id = gen_id where thread_id is null;
end $$;
