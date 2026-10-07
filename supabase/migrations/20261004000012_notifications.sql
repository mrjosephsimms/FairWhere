-- Alerts about a friend's round ("Mike finished hole 9 · on pace · done ~12:10",
-- "Mike is about 30 min from done", teed off, finished, ball hunt).
--
--   watches        what each person wants to hear about each friend (saved for all
--                  their future rounds). The golfer can see who's watching them.
--   notifications  the alerts themselves, one row per recipient. Created here on the
--                  server (trigger on rounds + a once-a-minute job), never by clients.
--                  Shown in the app now; `pushed_at` is for the iPhone push sender later.
--
-- The pace model (app/src/lib/pace.ts) is ported to SQL as round_eta() so the server
-- can say "done ~12:10" and know when someone is 30 minutes out.

-- ------------------------------------------------------------------ watches
create table public.watches (
  watcher_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  golfer_id         uuid not null references public.profiles (id) on delete cascade,
  every_hole        boolean not null default false,
  holes             smallint[] not null default '{}'
                    check (holes <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]::smallint[]),
  before_finish_min smallint check (before_finish_min in (15, 30, 45, 60)),
  tee_off           boolean not null default false,
  finished          boolean not null default false,
  ball_hunt         boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (watcher_id, golfer_id),
  check (watcher_id <> golfer_id)
);
create index watches_golfer_idx on public.watches (golfer_id);
alter table public.watches enable row level security;

create policy watches_select on public.watches for select to authenticated
  using (watcher_id = auth.uid() or golfer_id = auth.uid()); -- the golfer sees who gets updates
create policy watches_insert on public.watches for insert to authenticated
  with check (watcher_id = auth.uid() and public.is_friend(golfer_id));
create policy watches_update on public.watches for update to authenticated
  using (watcher_id = auth.uid()) with check (watcher_id = auth.uid() and public.is_friend(golfer_id));
create policy watches_delete on public.watches for delete to authenticated
  using (watcher_id = auth.uid());
revoke all on public.watches from anon;

-- ------------------------------------------------------------------ notifications
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade, -- recipient
  golfer_id  uuid not null references public.profiles (id) on delete cascade,
  round_id   uuid not null references public.rounds (id) on delete cascade,
  kind       text not null check (kind in ('hole', 'soon', 'tee_off', 'finished', 'ball_hunt')),
  hole       smallint,
  eta        timestamptz,
  delta_min  smallint,   -- minutes behind usual pace (+) or ahead (-)
  strokes    smallint,   -- 'finished': their total, if they kept score
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  pushed_at  timestamptz
);
-- Each alert at most once: hole updates and ball hunts once per hole; the rest once per round.
create unique index notifications_once on public.notifications
  (user_id, round_id, kind, (case when kind in ('hole', 'ball_hunt') then coalesce(hole, 0) else 0 end));
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications, public.watches;

-- ------------------------------------------------------------------ who may hear about a round
-- Same rule as rounds_select, for an explicit viewer (the trigger runs as the golfer).
create or replace function public.can_view_round(viewer uuid, r public.rounds) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_id = viewer and f.friend_id = r.user_id) or (f.friend_id = viewer and f.user_id = r.user_id)))
    and (r.visibility = 'friends' or exists (select 1 from public.round_viewers v where v.round_id = r.id and v.viewer_id = viewer));
$$;

-- ------------------------------------------------------------------ pace model (port of pace.ts)
-- Pars and yards in play order (playSequence in app/src/lib/courses.ts).
create or replace function public.round_plan(r public.rounds, out pars int[], out yards int[])
language sql stable security definer set search_path = public as $$
  with holes as (
    select h, (h ->> 'number')::int as num, h ->> 'nine' as nine
    from public.courses c, jsonb_array_elements(c.data -> 'holes') h
    where c.id = r.course_id
  ), ordered as (
    select h, row_number() over (
      order by case when r.nines is null then 0 when nine = r.nines[1] then 1 else 2 end, num) as n
    from holes
    where r.nines is null or nine = any (r.nines)
  )
  select array_agg((h ->> 'par')::int order by n), array_agg(nullif(h ->> 'yards', '')::int order by n) from ordered;
$$;

-- Estimated finish and minutes behind (+) / ahead (-) of usual pace, as of `at`.
create or replace function public.round_eta(r public.rounds, at timestamptz default now())
returns table (eta timestamptz, delta_min numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  pars int[]; yards int[]; w numeric[] := '{}'; a numeric[] := '{}';
  n int; i int; h int; total numeric; avg_y numeric; avg_w numeric; known int;
  before numeric := 0; on_hole numeric; frac numeric; expected numeric; elapsed numeric; p numeric;
  tee timestamptz := r.tee_time;
begin
  select rp.pars, rp.yards into pars, yards from public.round_plan(r) rp;
  n := coalesce(array_length(pars, 1), 0);
  if n = 0 then return; end if;
  for i in 1..n loop
    w := w || (case pars[i] when 3 then 0.78 when 4 then 1.0 when 5 then 1.22 else case when pars[i] > 5 then 1.44 else 1.0 end end)::numeric;
  end loop;
  if r.mode = 'walking' then -- walkers: part par weight, part yardage
    select avg(y), count(y) into avg_y, known from unnest(yards) y where y > 0;
    if known > 0 then
      select avg(x) into avg_w from unnest(w) x;
      for i in 1..n loop
        if yards[i] > 0 then w[i] := 0.65 * w[i] + 0.35 * avg_w * (yards[i] / avg_y); end if;
      end loop;
    end if;
  end if;
  select sum(x) into total from unnest(w) x;
  for i in 1..n loop a := a || (coalesce(nullif(r.target_minutes, 0), 255) * w[i] / total); end loop;
  total := coalesce(nullif(r.target_minutes, 0), 255);

  if r.status <> 'live' then
    return query select coalesce(r.finished_at, at), extract(epoch from coalesce(r.finished_at, at) - tee) / 60 - total;
    return;
  end if;
  if at < tee then
    return query select tee + total * interval '1 minute', 0::numeric;
    return;
  end if;
  h := least(greatest(coalesce(r.hole, 1), 1), n);
  for i in 1..h - 1 loop before := before + a[i]; end loop;
  on_hole := greatest(0, extract(epoch from at - coalesce(r.hole_started_at, tee)) / 60);
  frac := coalesce(r.hole_fraction, least(on_hole / a[h], 0.9)); -- never assume >90% of a hole from time alone
  expected := before + frac * a[h];
  elapsed := extract(epoch from at - tee) / 60;
  p := case when expected > 20 then elapsed / expected else 1 end;
  p := least(greatest(p, 0.8), 1.5);
  return query select at + (total - expected) * p * interval '1 minute', elapsed - expected;
end $$;

-- ------------------------------------------------------------------ alerts on round changes
create or replace function public.rounds_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k int; e record; total int;
begin
  -- Moved on: one alert per hole just completed, for anyone watching every hole or that hole.
  if new.status = 'live' and new.hole > old.hole then
    select * into e from public.round_eta(new);
    for k in old.hole .. new.hole - 1 loop
      insert into public.notifications (user_id, golfer_id, round_id, kind, hole, eta, delta_min)
      select w.watcher_id, new.user_id, new.id, 'hole', k, e.eta, round(e.delta_min)
        from public.watches w
       where w.golfer_id = new.user_id and (w.every_hole or k = any (w.holes)) and public.can_view_round(w.watcher_id, new)
      on conflict do nothing;
    end loop;
  end if;
  -- Finished (stopping sharing isn't announced, nor is the stale-round cleanup closing a
  -- round nobody has touched for hours).
  if new.status = 'done' and old.status = 'live' and old.updated_at > now() - interval '6 hours' then
    select sum(s.strokes) into total from public.round_scores s where s.round_id = new.id;
    insert into public.notifications (user_id, golfer_id, round_id, kind, hole, eta, strokes)
    select w.watcher_id, new.user_id, new.id, 'finished', new.hole, new.finished_at, total
      from public.watches w
     where w.golfer_id = new.user_id and w.finished and public.can_view_round(w.watcher_id, new)
    on conflict do nothing;
  end if;
  -- A ball hunt just started (at most one alert per hole).
  if new.status = 'live' and new.searching_since is not null and old.searching_since is null then
    insert into public.notifications (user_id, golfer_id, round_id, kind, hole)
    select w.watcher_id, new.user_id, new.id, 'ball_hunt', new.hole
      from public.watches w
     where w.golfer_id = new.user_id and w.ball_hunt and public.can_view_round(w.watcher_id, new)
    on conflict do nothing;
  end if;
  return null;
end $$;

create trigger rounds_notify
  after update on public.rounds
  for each row execute function public.rounds_notify();

-- ------------------------------------------------------------------ time-based alerts
-- Every minute: "teed off" once the tee time passes, and "about N min from done".
create or replace function public.notify_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds; e record;
begin
  for r in select * from public.rounds where status = 'live' and tee_time <= now() and updated_at > now() - interval '6 hours' loop
    insert into public.notifications (user_id, golfer_id, round_id, kind)
    select w.watcher_id, r.user_id, r.id, 'tee_off'
      from public.watches w
     where w.golfer_id = r.user_id and w.tee_off and public.can_view_round(w.watcher_id, r)
    on conflict do nothing;

    select * into e from public.round_eta(r);
    if e.eta is not null then
      insert into public.notifications (user_id, golfer_id, round_id, kind, hole, eta, delta_min)
      select w.watcher_id, r.user_id, r.id, 'soon', r.hole, e.eta, round(e.delta_min)
        from public.watches w
       where w.golfer_id = r.user_id and w.before_finish_min is not null
         and e.eta - now() <= w.before_finish_min * interval '1 minute'
         and public.can_view_round(w.watcher_id, r)
      on conflict do nothing;
    end if;
  end loop;
  delete from public.notifications where created_at < now() - interval '14 days';
end $$;
revoke execute on function public.notify_tick(), public.rounds_notify(), public.can_view_round(uuid, public.rounds)
  from public, anon, authenticated;
select cron.schedule('notify-tick', '* * * * *', $$select public.notify_tick()$$);
