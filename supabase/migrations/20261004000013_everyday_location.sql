-- Everyday location sharing (away from the course). OFF by default: nobody can see
-- where you are outside a round unless YOU grant it, per person, for a while
-- (1 hour / until end of day) or until you turn it off. Only the owner grants it;
-- nobody can request or switch it on for themselves.
--
-- Plus a server-side backup for rounds left running after the golfer has gone home:
-- if their latest fix is far from the course, the minute job finishes the round.

create table public.location_shares (
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz, -- null = until the owner turns it off
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index location_shares_viewer_idx on public.location_shares (viewer_id);
alter table public.location_shares enable row level security;
create policy location_shares_select on public.location_shares for select to authenticated
  using (owner_id = auth.uid() or viewer_id = auth.uid());
create policy location_shares_insert on public.location_shares for insert to authenticated
  with check (owner_id = auth.uid() and public.is_friend(viewer_id));
create policy location_shares_update on public.location_shares for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.is_friend(viewer_id));
-- The owner can stop sharing; the viewer can also stop seeing it.
create policy location_shares_delete on public.location_shares for delete to authenticated
  using (owner_id = auth.uid() or viewer_id = auth.uid());
revoke all on public.location_shares from anon;

-- Your latest everyday position (one row). Visible only to people you're actively sharing with.
create table public.locations (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  accuracy   real,
  updated_at timestamptz not null default now()
);
alter table public.locations enable row level security;

create or replace function public.shares_location_with(owner uuid, viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.location_shares s
    where s.owner_id = owner and s.viewer_id = viewer and (s.expires_at is null or s.expires_at > now())
      and public.is_friend(owner));
$$;
revoke execute on function public.shares_location_with(uuid, uuid) from public, anon;
grant execute on function public.shares_location_with(uuid, uuid) to authenticated;

create policy locations_select on public.locations for select to authenticated
  using (user_id = auth.uid() or public.shares_location_with(user_id, auth.uid()));
create policy locations_insert on public.locations for insert to authenticated with check (user_id = auth.uid());
create policy locations_update on public.locations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy locations_delete on public.locations for delete to authenticated using (user_id = auth.uid());
revoke all on public.locations from anon;

-- Stop sharing with the last person -> forget the stored position too.
create or replace function public.location_shares_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.location_shares where owner_id = old.owner_id and (expires_at is null or expires_at > now())) then
    delete from public.locations where user_id = old.owner_id;
  end if;
  return null;
end $$;
create trigger location_shares_cleanup after delete on public.location_shares
  for each row execute function public.location_shares_cleanup();

alter publication supabase_realtime add table public.location_shares, public.locations;

-- ------------------------------------------------------------------ course distance
-- Metres from a point to the nearest point of any hole on the course (tee-to-green lines).
create or replace function public.metres_from_course(course text, lat double precision, lng double precision) returns double precision
language sql stable security definer set search_path = public as $$
  select min(111320 * sqrt(power((p.plat - lat), 2) + power((p.plng - lng) * cos(radians(lat)), 2)))
  from public.courses c,
       jsonb_array_elements(c.data -> 'holes') h,
       lateral (select (pt ->> 0)::float8 as plat, (pt ->> 1)::float8 as plng from jsonb_array_elements(h -> 'centerline') pt) p
  where c.id = course;
$$;

-- ------------------------------------------------------------------ minute job, extended
create or replace function public.notify_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds; e record;
begin
  -- Gone home without finishing: a fresh fix more than 2 km from the course ends the round.
  update public.rounds set status = 'done'
   where status = 'live' and last_fix_at > now() - interval '30 minutes' and last_lat is not null
     and public.metres_from_course(course_id, last_lat, last_lng) > 2000;

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

  -- Expired everyday shares end (the cleanup trigger forgets the position if it was the last).
  delete from public.location_shares where expires_at <= now();
end $$;
revoke execute on function public.notify_tick() from public, anon, authenticated;
