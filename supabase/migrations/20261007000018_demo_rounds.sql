-- Demo rounds for App Review and store screenshots (docs/APP_STORE.md). A demo golfer always has
-- a round in progress: a 4-hour loop on their course, moved along every 5 minutes (hole, position
-- on the hole, scores so far), so a reviewer can see live sharing at any hour without golfing.
-- Only accounts listed in demo_players are touched. Remove a row to stop.

create table public.demo_players (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  course_id text not null references public.courses (id),
  cycle_min int not null default 240 check (cycle_min between 60 and 480)
);
alter table public.demo_players enable row level security;  -- no policies: server-side only
revoke all on public.demo_players from anon, authenticated;

create or replace function public.demo_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  d       public.demo_players;
  r       public.rounds;
  started timestamptz;
  per     double precision;   -- minutes per hole
  played  double precision;   -- minutes into the round
  h       int;
  frac    double precision;
  hole_j  jsonb;
  line    jsonb;
  pt      jsonb;
begin
  for d in select * from public.demo_players loop
    per := d.cycle_min / 18.0;
    -- Rounds start on the cycle's boundaries (e.g. every 4 h on the clock).
    started := to_timestamp(floor(extract(epoch from now()) / (d.cycle_min * 60)) * (d.cycle_min * 60));
    played := extract(epoch from now() - started) / 60;

    select * into r from public.rounds where user_id = d.user_id and status = 'live' limit 1;
    if r.id is not null and r.tee_time < started then
      update public.rounds set status = 'done' where id = r.id;  -- last loop's round is over
      r := null;
    end if;
    if r.id is null then
      insert into public.rounds (user_id, course_id, tee_time, target_minutes, mode, visibility)
      values (d.user_id, d.course_id, started, d.cycle_min, 'riding', 'friends')
      returning * into r;
    end if;

    h := least(18, 1 + floor(played / per))::int;
    frac := least(1, greatest(0, played / per - (h - 1)));
    select x into hole_j from public.courses c, jsonb_array_elements(c.data -> 'holes') x
     where c.id = d.course_id and (x ->> 'number')::int = h limit 1;
    line := hole_j -> 'centerline';
    pt := line -> least(jsonb_array_length(line) - 1, floor(frac * jsonb_array_length(line))::int);

    update public.rounds
       set hole = h,
           hole_started_at = case when hole <> h then started + make_interval(secs => (h - 1) * per * 60) else hole_started_at end,
           hole_fraction = frac,
           last_lat = (pt ->> 0)::float8, last_lng = (pt ->> 1)::float8, last_fix_at = now()
     where id = r.id;

    -- Scores for the holes already played: par, with a bogey every third hole and a birdie on 7.
    insert into public.round_scores (round_id, hole, strokes)
    select r.id, (x ->> 'number')::int,
           (x ->> 'par')::int + case when (x ->> 'number')::int = 7 then -1 when (x ->> 'number')::int % 3 = 0 then 1 else 0 end
      from public.courses c, jsonb_array_elements(c.data -> 'holes') x
     where c.id = d.course_id and (x ->> 'number')::int < h
    on conflict do nothing;
  end loop;
end $$;
revoke execute on function public.demo_tick() from public, anon, authenticated;
select cron.schedule('demo-tick', '*/5 * * * *', $$select public.demo_tick()$$);
