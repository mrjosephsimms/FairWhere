-- "Looking for a ball?": the golfer's phone sets searching_since when they've
-- lingered in one spot off the fairway (app/src/lib/onCourse.ts) and clears it
-- when they move on. Friends see it on the round. Wiped on finish like the
-- coordinates it was derived from.
alter table public.rounds add column searching_since timestamptz;

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
    -- Location sharing stops on finish: never keep raw coordinates (or what they implied).
    new.last_lat := null; new.last_lng := null; new.last_fix_at := null; new.hole_fraction := null;
    new.searching_since := null;
  end if;
  return new;
end $$;
