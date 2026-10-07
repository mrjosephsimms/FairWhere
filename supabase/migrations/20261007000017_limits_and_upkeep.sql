-- Backend ready for real users (docs/LAUNCH_GOAL.md step 6): rate limits on the things one
-- account could spam, a size/type cap on profile photos, and upkeep for the job logs.

-- ------------------------------------------------------------------ friend requests
-- At most 20 new requests an hour and 60 a day per person (accepting someone's request is free).
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
  if (select count(*) from public.friendships where user_id = me and created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.friendships where user_id = me and created_at > now() - interval '1 day') >= 60 then
    raise exception 'You''ve sent a lot of requests. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.friendships (user_id, friend_id) values (me, target);
  return 'pending';
end $$;

-- ------------------------------------------------------------------ reports
-- At most 10 reports a day, and one per person per day (a second one adds nothing for review).
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
  if reason is null or reason not in ('photo', 'name', 'harassment', 'spam', 'other') then
    raise exception 'pick a reason' using errcode = '22023';
  end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of reports today. We''ll review them; try again tomorrow.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.reports where reporter_id = me and reported_id = target and created_at > now() - interval '1 day') then
    select * into p from public.profiles where id = target;
    insert into public.reports (reporter_id, reported_id, reported_name, reported_handle, reported_photo, reason, details)
    values (me, target, p.display_name, p.username, p.avatar_url, reason, nullif(trim(details), ''));
  end if;
  if also_block then perform public.block_user(target); end if;
end $$;

-- ------------------------------------------------------------------ profile photos
-- The app uploads a resized JPEG (~100–300 KB); refuse anything else.
update storage.buckets set file_size_limit = 2 * 1024 * 1024, allowed_mime_types = array['image/jpeg']
 where id = 'avatars';

-- ------------------------------------------------------------------ upkeep
-- pg_cron logs every run (~2,900 a day here) and never trims them.
create or replace function public.trim_job_logs() returns void
language sql security definer set search_path = public as $$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$$;
revoke execute on function public.trim_job_logs() from public, anon, authenticated;
select cron.schedule('trim-job-logs', '17 4 * * *', $$select public.trim_job_logs()$$);
