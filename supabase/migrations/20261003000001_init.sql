-- Find My Golfer — core schema + row-level security (HANDOFF §4).
--
-- Privacy model:
--   * A round is visible to its owner, and to ACCEPTED friends while it is
--     live (and updated in the last 6h) or for 4h after it finished.
--   * visibility = 'selected' narrows that to friends listed in round_viewers.
--   * Raw coordinates are nulled the moment a round stops being live.
--   * Friend requests go through SECURITY DEFINER RPCs; nobody can insert a
--     friendship row (or flip one to accepted) directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles

create or replace function public.gen_friend_code() returns text
language sql volatile as $$
  -- 6 chars, no 0/O/1/I/L so codes survive being read aloud on the range.
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6);
$$;

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_url   text,
  friend_code  text not null unique default public.gen_friend_code(),
  created_at   timestamptz not null default now()
);

-- New auth user -> profile row. Retries on the (rare) friend_code collision.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nm text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    '');
begin
  for i in 1..5 loop
    begin
      insert into public.profiles (id, display_name) values (new.id, left(nm, 40));
      return new;
    exception when unique_violation then
      if exists (select 1 from public.profiles where id = new.id) then return new; end if;
    end;
  end loop;
  raise exception 'could not allocate a friend code';
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------- friendships

-- One row per pair: user_id asked, friend_id was asked.
create table public.friendships (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create unique index friendships_pair_uniq
  on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));
create index friendships_friend_idx on public.friendships (friend_id);

-- Helpers are SECURITY DEFINER so policies can call them without recursing
-- through each other's RLS.
create or replace function public.is_friend(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_id = auth.uid() and f.friend_id = other)
        or (f.friend_id = auth.uid() and f.user_id = other)));
$$;

create or replace function public.has_friendship_row(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where (f.user_id = auth.uid() and f.friend_id = other)
       or (f.friend_id = auth.uid() and f.user_id = other));
$$;

-- Send a request by friend code. If they already asked you, this accepts it.
-- Returns 'pending' | 'accepted'.
create or replace function public.request_friend(code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  target uuid;
  fr     public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  select id into target from public.profiles where friend_code = upper(trim(code));
  if target is null then raise exception 'No golfer has that code' using errcode = 'P0002'; end if;
  if target = me then raise exception 'That''s your own code' using errcode = '22023'; end if;

  select * into fr from public.friendships
   where (user_id = me and friend_id = target) or (user_id = target and friend_id = me);
  if found then
    if fr.status = 'pending' and fr.friend_id = me then
      update public.friendships set status = 'accepted'
       where user_id = fr.user_id and friend_id = fr.friend_id;
      return 'accepted';
    end if;
    return fr.status;
  end if;

  insert into public.friendships (user_id, friend_id) values (me, target);
  return 'pending';
end $$;

-- Accept or decline a request someone sent you.
create or replace function public.respond_friend(requester uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if accept then
    update public.friendships set status = 'accepted'
     where user_id = requester and friend_id = auth.uid() and status = 'pending';
  else
    delete from public.friendships
     where user_id = requester and friend_id = auth.uid() and status = 'pending';
  end if;
end $$;

-- ------------------------------------------------------------------ courses

create table public.courses (
  id         text primary key,
  name       text not null,
  address    text,
  nines      text[],         -- null = plain 18; else 9-hole loops, a round = two different ones
  data       jsonb not null, -- full course record from data/courses.json (holes, centerlines, greens)
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- rounds

create table public.rounds (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  course_id       text not null references public.courses (id),
  nines           text[],
  tee_time        timestamptz not null,
  target_minutes  int not null default 255 check (target_minutes between 120 and 420),
  hole            int not null default 1 check (hole between 1 and 18),
  hole_started_at timestamptz not null default now(),
  hole_fraction   real check (hole_fraction between 0 and 1),
  last_lat        double precision,
  last_lng        double precision,
  last_fix_at     timestamptz,
  status          text not null default 'live' check (status in ('live', 'done', 'cancelled')),
  visibility      text not null default 'friends' check (visibility in ('friends', 'selected')),
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index rounds_one_live_per_user on public.rounds (user_id) where status = 'live';
create index rounds_user_status_idx on public.rounds (user_id, status);

create or replace function public.rounds_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  course_nines text[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'live' then raise exception 'a round starts live'; end if;
    select nines into course_nines from public.courses where id = new.course_id;
    if course_nines is null then
      new.nines := null;
    elsif new.nines is null or cardinality(new.nines) <> 2 or new.nines[1] = new.nines[2]
          or not (new.nines <@ course_nines) then
      raise exception 'pick two different nines from %', course_nines using errcode = '22023';
    end if;
  else
    if old.status <> 'live' and new.status = 'live' then
      raise exception 'a finished round can''t be restarted';
    end if;
    if new.user_id <> old.user_id or new.course_id <> old.course_id
       or new.nines is distinct from old.nines then
      raise exception 'round owner/course can''t change';
    end if;
  end if;

  new.updated_at := now();
  if new.status <> 'live' then
    new.finished_at := coalesce(new.finished_at, now());
    -- Location sharing stops on finish: never keep raw coordinates.
    new.last_lat := null; new.last_lng := null; new.last_fix_at := null; new.hole_fraction := null;
  end if;
  return new;
end $$;

create trigger rounds_guard
  before insert or update on public.rounds
  for each row execute function public.rounds_guard();

create table public.round_viewers (
  round_id  uuid not null references public.rounds (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  primary key (round_id, viewer_id)
);
create index round_viewers_viewer_idx on public.round_viewers (viewer_id);

create or replace function public.owns_round(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rounds where id = rid and user_id = auth.uid());
$$;

create or replace function public.is_round_viewer(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.round_viewers where round_id = rid and viewer_id = auth.uid());
$$;

-- v1.1 web share page for non-users (table only; no policies = no client access yet).
create table public.share_links (
  token      text primary key default encode(gen_random_bytes(18), 'base64'),
  round_id   uuid not null references public.rounds (id) on delete cascade,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------- RLS

alter table public.profiles      enable row level security;
alter table public.friendships   enable row level security;
alter table public.courses       enable row level security;
alter table public.rounds        enable row level security;
alter table public.round_viewers enable row level security;
alter table public.share_links   enable row level security;

-- profiles: yourself, plus anyone you have a request/friendship with.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_friendship_row(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- friendships: both sides can see and remove (unfriend / cancel / decline).
-- Inserts and accepts only via request_friend / respond_friend.
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (user_id, friend_id));
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (user_id, friend_id));
revoke insert, update on public.friendships from authenticated, anon;

-- courses: read-only reference data.
create policy courses_select on public.courses for select to authenticated using (true);
revoke insert, update, delete on public.courses from authenticated, anon;

-- rounds
create policy rounds_select on public.rounds for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_friend(user_id)
      and (visibility = 'friends' or public.is_round_viewer(id))
      and (
        (status = 'live' and updated_at > now() - interval '6 hours')
        or (status = 'done' and finished_at > now() - interval '4 hours')
      )
    )
  );
create policy rounds_insert on public.rounds for insert to authenticated
  with check (user_id = auth.uid());
create policy rounds_update on public.rounds for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy rounds_delete on public.rounds for delete to authenticated
  using (user_id = auth.uid());

-- round_viewers: the owner manages the list (friends only); a viewer sees their own row.
create policy round_viewers_select on public.round_viewers for select to authenticated
  using (viewer_id = auth.uid() or public.owns_round(round_id));
create policy round_viewers_insert on public.round_viewers for insert to authenticated
  with check (public.owns_round(round_id) and public.is_friend(viewer_id));
create policy round_viewers_delete on public.round_viewers for delete to authenticated
  using (public.owns_round(round_id));

-- Lock down the definer functions to signed-in users.
revoke execute on function public.request_friend(text), public.respond_friend(uuid, boolean),
  public.is_friend(uuid), public.has_friendship_row(uuid), public.owns_round(uuid),
  public.is_round_viewer(uuid) from public, anon;
grant execute on function public.request_friend(text), public.respond_friend(uuid, boolean),
  public.is_friend(uuid), public.has_friendship_row(uuid), public.owns_round(uuid),
  public.is_round_viewer(uuid) to authenticated;

-- ----------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.rounds, public.friendships;
