-- "Play this hole": friends replay a hole someone is playing for real and try to
-- beat their score (app/src/lib/game.ts). Anyone who can see the round can play
-- its holes and see everyone's results (via the reader's own rounds policy);
-- you can only record your own plays. Kept until the round is deleted.
create table public.game_plays (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds (id) on delete cascade,
  hole       smallint not null check (hole between 1 and 18),
  player_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  strokes    smallint not null check (strokes between 1 and 10),
  created_at timestamptz not null default now()
);
create index game_plays_round_idx on public.game_plays (round_id, hole);
alter table public.game_plays enable row level security;

create policy game_plays_select on public.game_plays for select to authenticated
  using (exists (select 1 from public.rounds r where r.id = round_id));
create policy game_plays_insert on public.game_plays for insert to authenticated
  with check (player_id = auth.uid() and exists (select 1 from public.rounds r where r.id = round_id));
create policy game_plays_delete on public.game_plays for delete to authenticated
  using (player_id = auth.uid());
revoke update on public.game_plays from authenticated;
revoke all on public.game_plays from anon;

alter publication supabase_realtime add table public.game_plays;
