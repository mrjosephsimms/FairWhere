-- Auto-stop: a live round with no update for 6 hours is closed out (HANDOFF §6).
-- rounds_select already hides such rounds from friends; this also clears the
-- coordinates (rounds_guard nulls them when status leaves 'live') and frees
-- the one-live-round-per-user slot.

create or replace function public.expire_stale_rounds() returns int
language sql security definer set search_path = public as $$
  with closed as (
    update public.rounds
       set status = 'done', finished_at = updated_at
     where status = 'live' and updated_at < now() - interval '6 hours'
    returning 1)
  select count(*)::int from closed;
$$;
revoke execute on function public.expire_stale_rounds() from public, anon, authenticated;

-- Run every 15 minutes via pg_cron (available on every Supabase project).
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('expire-stale-rounds', '*/15 * * * *', $$select public.expire_stale_rounds()$$);
