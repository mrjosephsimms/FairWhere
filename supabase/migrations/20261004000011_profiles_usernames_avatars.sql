-- Profiles: a unique @username (also a way to add friends) and a photo.
alter table public.profiles add column username text unique
  check (username ~ '^[a-z0-9_.]{3,20}$');
grant update (username) on public.profiles to authenticated;

-- Add a friend by friend code or by @username. If they already asked you, this accepts it.
-- Returns 'pending' | 'accepted'.
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
  if target is null then raise exception 'No golfer has that code or username' using errcode = 'P0002'; end if;
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

-- Hole game: remember the score you were trying to beat (for your record), and keep
-- your own plays visible to you after the friend's round drops out of view.
alter table public.game_plays add column to_beat smallint check (to_beat between 1 and 20);
drop policy game_plays_select on public.game_plays;
create policy game_plays_select on public.game_plays for select to authenticated
  using (player_id = auth.uid() or exists (select 1 from public.rounds r where r.id = round_id));

-- Profile photos: public bucket (unguessable paths), each user writes only their own folder.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
