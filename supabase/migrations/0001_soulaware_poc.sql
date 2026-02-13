create extension if not exists pgcrypto;

create table if not exists guest_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references guest_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  mode text not null check (mode in ('coach', 'safety')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists purpose_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references guest_sessions(id) on delete cascade,
  mission text not null,
  values_json jsonb not null default '[]'::jsonb,
  next_actions_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists safety_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references guest_sessions(id) on delete cascade,
  level text not null check (level in ('none', 'elevated', 'high')),
  trigger_text text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null,
  event_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_chat_messages_session_created
  on chat_messages(session_id, created_at);

create index if not exists idx_purpose_snapshots_session_created
  on purpose_snapshots(session_id, created_at desc);

create index if not exists idx_safety_events_session_created
  on safety_events(session_id, created_at desc);

create index if not exists idx_analytics_events_guest_created
  on analytics_events(guest_id, created_at desc);

alter table guest_sessions enable row level security;
alter table chat_messages enable row level security;
alter table purpose_snapshots enable row level security;
alter table safety_events enable row level security;
alter table analytics_events enable row level security;

drop policy if exists "service_role_full_guest_sessions" on guest_sessions;
drop policy if exists "service_role_full_chat_messages" on chat_messages;
drop policy if exists "service_role_full_purpose_snapshots" on purpose_snapshots;
drop policy if exists "service_role_full_safety_events" on safety_events;
drop policy if exists "service_role_full_analytics_events" on analytics_events;

create policy "service_role_full_guest_sessions"
  on guest_sessions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_full_chat_messages"
  on chat_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_full_purpose_snapshots"
  on purpose_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_full_safety_events"
  on safety_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_full_analytics_events"
  on analytics_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
