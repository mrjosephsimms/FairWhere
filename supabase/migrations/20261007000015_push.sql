-- iPhone push for alerts (docs/LAUNCH_GOAL.md step 3).
--
-- Alerts are already rows in public.notifications (made by rounds_notify / notify_tick, only
-- for what each watcher asked for). Here: the phones to send them to, and a nudge to the
-- `push` Edge Function whenever new rows land (plus a once-a-minute sweep as a backstop).
-- The function claims rows with claim_pushes() (stamps pushed_at first, so a row is never
-- pushed twice) and delivers them over APNs.

create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------------ phones
create table public.device_tokens (
  token      text primary key,  -- APNs device token (hex)
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  platform   text not null default 'ios' check (platform in ('ios')),
  env        text check (env in ('sandbox', 'production')),  -- learned by the sender on first send
  tz         text not null default 'America/Los_Angeles',   -- push text shows times in the phone's zone
  updated_at timestamptz not null default now()
);
create index device_tokens_user_idx on public.device_tokens (user_id);
alter table public.device_tokens enable row level security;
create policy device_tokens_select on public.device_tokens for select to authenticated using (user_id = auth.uid());
-- Signing out forgets this phone.
create policy device_tokens_delete on public.device_tokens for delete to authenticated using (user_id = auth.uid());
-- Writes go through register_device() (a phone can move between accounts).
revoke insert, update on public.device_tokens from authenticated;
revoke all on public.device_tokens from anon;

create or replace function public.register_device(p_token text, p_tz text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  zone text := coalesce(nullif(p_tz, ''), 'America/Los_Angeles');
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_token !~ '^[0-9a-fA-F]{64,200}$' then raise exception 'bad device token' using errcode = '22023'; end if;
  if not exists (select 1 from pg_timezone_names where name = zone) then zone := 'America/Los_Angeles'; end if;
  insert into public.device_tokens (token, user_id, tz, updated_at)
  values (lower(p_token), auth.uid(), zone, now())
  on conflict (token) do update
    set user_id = excluded.user_id, tz = excluded.tz, updated_at = now(),
        env = case when public.device_tokens.user_id = excluded.user_id then public.device_tokens.env end;
end $$;
revoke execute on function public.register_device(text, text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;

-- ------------------------------------------------------------------ sender side
-- Does this watch still want this alert? (Checked again at send time, in case they turned it off.)
create or replace function public.watch_wants(w public.watches, kind text, hole smallint) returns boolean
language sql immutable as $$
  select case kind
    when 'hole'      then w.every_hole or hole = any (w.holes)
    when 'soon'      then w.before_finish_min is not null
    when 'tee_off'   then w.tee_off
    when 'finished'  then w.finished
    when 'ball_hunt' then w.ball_hunt
    else false end;
$$;

-- Claim up to `max_rows` new alerts for sending: stamps pushed_at first (at most once), then
-- returns one row per (alert, phone) that still wants it. Older than 30 min: too late to push.
create or replace function public.claim_pushes(max_rows int default 200)
returns table (
  id uuid, kind text, hole smallint, eta timestamptz, delta_min smallint, strokes smallint, created_at timestamptz,
  round_id uuid, golfer_id uuid, golfer_name text, course_name text, token text, env text, tz text
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select n.id from public.notifications n
     where n.pushed_at is null and n.created_at > now() - interval '30 minutes'
     order by n.created_at
     limit max_rows
     for update skip locked
  ), claimed as (
    update public.notifications n set pushed_at = now() from due where n.id = due.id returning n.*
  )
  select c.id, c.kind, c.hole, c.eta, c.delta_min, c.strokes, c.created_at, c.round_id, c.golfer_id,
         coalesce(nullif(p.display_name, ''), 'Your friend'), co.name, d.token, d.env, d.tz
    from claimed c
    join public.profiles p on p.id = c.golfer_id
    join public.rounds r on r.id = c.round_id
    join public.courses co on co.id = r.course_id
    join public.watches w on w.watcher_id = c.user_id and w.golfer_id = c.golfer_id
    join public.device_tokens d on d.user_id = c.user_id
   where public.watch_wants(w, c.kind, c.hole);
end $$;

-- The sender reports what each token turned out to be (or that it's dead).
create or replace function public.push_feedback(p_token text, p_env text, p_dead boolean) returns void
language sql security definer set search_path = public as $$
  delete from public.device_tokens where token = p_token and p_dead;
  update public.device_tokens set env = p_env where token = p_token and not p_dead and p_env in ('sandbox', 'production');
$$;

-- Only the Edge Function (service role) may claim or report.
revoke execute on function public.claim_pushes(int) from public, anon, authenticated;
revoke execute on function public.push_feedback(text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_pushes(int) to service_role;
grant execute on function public.push_feedback(text, text, boolean) to service_role;

-- ------------------------------------------------------------------ waking the sender
-- Where the Edge Function lives. One row; empty url = don't call (local tests, other projects).
create table public.push_config (
  id  boolean primary key default true check (id),
  url text not null default ''
);
alter table public.push_config enable row level security;  -- no policies: server-side only
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (url) values ('https://uvyeenrkkvvsizszdizv.supabase.co/functions/v1/push');

create or replace function public.kick_push() returns void
language plpgsql security definer set search_path = public as $$
declare
  target text := (select url from public.push_config);
begin
  if coalesce(target, '') = '' then return; end if;
  -- Async (pg_net): queued with this transaction, sent after it commits.
  perform net.http_post(url := target, body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;
revoke execute on function public.kick_push() from public, anon, authenticated;

create or replace function public.notifications_kick() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.kick_push();
  return null;
end $$;
create trigger notifications_kick after insert on public.notifications
  for each statement execute function public.notifications_kick();

-- Backstop: anything new and unpushed gets another nudge each minute.
create or replace function public.push_sweep() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.notifications where pushed_at is null and created_at > now() - interval '30 minutes') then
    perform public.kick_push();
  end if;
end $$;
revoke execute on function public.push_sweep() from public, anon, authenticated;
select cron.schedule('push-sweep', '* * * * *', $$select public.push_sweep()$$);
