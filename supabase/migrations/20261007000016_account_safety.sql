-- App Review requirements (docs/LAUNCH_GOAL.md step 4): delete your account, block and report people.

-- ------------------------------------------------------------------ delete account (Apple 5.1.1(v))
-- Removing the auth user cascades through profiles to everything: rounds, scores, friendships,
-- watches, alerts, phones, locations, location shares, hole-game plays, blocks. The profile photo
-- lives in Storage, which the app removes first (Storage objects must go through its API).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  delete from auth.users where id = me;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ------------------------------------------------------------------ blocking
create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);
alter table public.blocks enable row level security;
create policy blocks_select on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = auth.uid()); -- unblock
revoke insert, update on public.blocks from authenticated;
revoke all on public.blocks from anon;

create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

-- Block someone: you vanish for each other (no friendship row means no profile, rounds or
-- location either way), their alerts and shares stop, and neither of you can send a request.
create or replace function public.block_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if target is null or target = me then raise exception 'pick someone else' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'no such golfer' using errcode = 'P0002'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, target) on conflict do nothing;
  delete from public.friendships where (user_id = me and friend_id = target) or (user_id = target and friend_id = me);
  delete from public.watches where (watcher_id = me and golfer_id = target) or (watcher_id = target and golfer_id = me);
  delete from public.location_shares where (owner_id = me and viewer_id = target) or (owner_id = target and viewer_id = me);
  delete from public.notifications where (user_id = me and golfer_id = target) or (user_id = target and golfer_id = me);
  delete from public.round_viewers v using public.rounds r
   where r.id = v.round_id and ((r.user_id = me and v.viewer_id = target) or (r.user_id = target and v.viewer_id = me));
end $$;
revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- Your block list, with names (their profile is otherwise hidden from you once blocked).
create or replace function public.my_blocks()
returns table (id uuid, display_name text, username text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username, b.created_at
    from public.blocks b join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;
revoke execute on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated;

-- Friend requests skip blocked pairs, and say "not found" so a block isn't revealed.
create or replace function public.request_friend(code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  target uuid;
  fr     public.friendships;
  q      text := trim(code);
begin
  if me is null then raise exception 'not signed in'; end if;
  if left(q, 1) <> '@' then
    select id into target from public.profiles where friend_code = upper(q);
  end if;
  if target is null then
    select id into target from public.profiles where username = lower(ltrim(q, '@'));
  end if;
  if target is null or public.is_blocked_between(me, target) then
    raise exception 'No golfer has that code or username' using errcode = 'P0002';
  end if;
  if target = me then raise exception 'That''s you' using errcode = '22023'; end if;
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

-- ------------------------------------------------------------------ reports
-- Checked by Sunny (Apple 1.2: act on reports within 24 h). Keeps a snapshot of what was
-- reported, so it still makes sense if either account is deleted.
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid references public.profiles (id) on delete set null,
  reported_id      uuid references public.profiles (id) on delete set null,
  reported_name    text,
  reported_handle  text,
  reported_photo   text,
  reason           text not null check (reason in ('photo', 'name', 'harassment', 'spam', 'other')),
  details          text check (char_length(details) <= 1000),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index reports_open_idx on public.reports (created_at) where resolved_at is null;
alter table public.reports enable row level security;  -- no policies: written by report_user, read in the dashboard
revoke all on public.reports from anon, authenticated;

-- Report someone you can see (a buddy or a pending request), optionally blocking them too.
create or replace function public.report_user(target uuid, reason text, details text default null, also_block boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p  public.profiles;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if target = me then raise exception 'pick someone else' using errcode = '22023'; end if;
  if not public.has_friendship_row(target) then raise exception 'no such golfer' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = target;
  insert into public.reports (reporter_id, reported_id, reported_name, reported_handle, reported_photo, reason, details)
  values (me, target, p.display_name, p.username, p.avatar_url, reason, nullif(trim(details), ''));
  if also_block then perform public.block_user(target); end if;
end $$;
revoke execute on function public.report_user(uuid, text, text, boolean) from public, anon;
grant execute on function public.report_user(uuid, text, text, boolean) to authenticated;
