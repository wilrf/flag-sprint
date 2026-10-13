-- One row per player: the game's whole save object (history, marks, best scores, settings).
-- The client merges by `state->>'t'` (newest wins), so the server only stores and guards it.
create table public.flag_sprint_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.flag_sprint_state enable row level security;

-- Signed-out visitors get nothing; signed-in players touch only their own row.
revoke all on public.flag_sprint_state from anon;

create policy "read own state" on public.flag_sprint_state
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "insert own state" on public.flag_sprint_state
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "update own state" on public.flag_sprint_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
