-- The golfer's own scorecard: strokes per hole. Private to the golfer for now
-- (HANDOFF §8 leaves "show scores to friends?" open; opening it up later is a
-- select policy). Kept after the round ends; deleted with the round.
create table public.round_scores (
  round_id   uuid not null references public.rounds (id) on delete cascade,
  hole       smallint not null check (hole between 1 and 18),
  strokes    smallint not null check (strokes between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (round_id, hole)
);
alter table public.round_scores enable row level security;

create policy round_scores_select on public.round_scores for select to authenticated
  using (public.owns_round(round_id));
create policy round_scores_insert on public.round_scores for insert to authenticated
  with check (public.owns_round(round_id));
create policy round_scores_update on public.round_scores for update to authenticated
  using (public.owns_round(round_id)) with check (public.owns_round(round_id));
create policy round_scores_delete on public.round_scores for delete to authenticated
  using (public.owns_round(round_id));
revoke all on public.round_scores from anon;
