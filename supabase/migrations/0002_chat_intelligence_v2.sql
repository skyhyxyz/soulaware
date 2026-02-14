create table if not exists chat_session_state (
  session_id uuid primary key references guest_sessions(id) on delete cascade,
  rolling_summary text not null default '',
  user_facts_json jsonb not null default '[]'::jsonb,
  open_loops_json jsonb not null default '[]'::jsonb,
  pending_clarifier boolean not null default false,
  clarifier_topic text not null default '',
  last_lens text not null default '',
  last_model text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_chat_session_state_updated
  on chat_session_state(updated_at desc);

alter table chat_session_state enable row level security;

drop policy if exists "service_role_full_chat_session_state" on chat_session_state;

create policy "service_role_full_chat_session_state"
  on chat_session_state
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
