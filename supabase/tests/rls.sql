-- RLS / privacy tests. Run via scripts/test-db.sh (fails on the first broken expectation).
-- Users: A (Sunny), B (friend), C (stranger), D (friend of A and B).

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok   %', msg;
end $$;

create function pg_temp.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok   % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: expected an error: %', msg;
end $$;

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'sunny@example.com', '{"full_name":"Sunny"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com',   '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com',  '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com',   '{"name":"Dan"}');

select pg_temp.ok((select count(*) = 4 from public.profiles), 'signup trigger creates profiles');
select pg_temp.ok((select display_name = 'Sunny' from public.profiles where id::text like '%a'), 'display name from full_name');
select pg_temp.ok((select display_name = 'bob' from public.profiles where id::text like '%b'), 'display name falls back to email');
select pg_temp.ok((select bool_and(friend_code ~ '^[A-HJ-KMNP-Z2-9]{6}$') from public.profiles), 'friend codes are 6 unambiguous chars');
select pg_temp.ok((select count(*) = 2 from public.courses), 'courses seeded');

-- Codes for the tests (read as superuser).
create temp table codes as select display_name, friend_code, id from public.profiles;
grant select on codes to authenticated;
create function pg_temp.code(uid_suffix text) returns text language sql as $$
  select friend_code from codes where id::text like '%' || uid_suffix
$$;

-- ---------------------------------------------------------------- profiles / friends
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.profiles), 'A sees only own profile before any friends');
select pg_temp.fails($$insert into public.friendships values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','accepted')$$,
  'direct friendship insert is blocked');
select pg_temp.fails($$update public.profiles set friend_code = 'AAAAAA'$$, 'friend_code is not user-editable');
update public.profiles set display_name = 'Sunny S';
select pg_temp.ok((select display_name = 'Sunny S' from public.profiles where id = auth.uid()), 'A can rename self');
select pg_temp.fails($$select public.request_friend('ZZZZZ9')$$, 'unknown code rejected');
select pg_temp.fails(format('select public.request_friend(%L)', pg_temp.code('a')), 'own code rejected');
select pg_temp.ok(public.request_friend(lower(pg_temp.code('b'))) = 'pending', 'A -> B request pending (code is case-insensitive)');
select pg_temp.ok(public.request_friend(pg_temp.code('c')) = 'pending', 'A -> C request pending');
select pg_temp.ok(public.request_friend(pg_temp.code('d')) = 'pending', 'A -> D request pending');
select pg_temp.ok((select count(*) = 4 from public.profiles), 'A sees profiles of people they asked');
select public.respond_friend('00000000-0000-0000-0000-00000000000d', true);  -- A can't accept own outbound
select pg_temp.ok((select status = 'pending' from public.friendships where friend_id::text like '%d'), 'requester cannot accept own request');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 2 from public.profiles), 'B sees self + requester A');
select pg_temp.ok(public.request_friend(pg_temp.code('a')) = 'accepted', 'B asking A back accepts the pending request');
select pg_temp.fails($$update public.friendships set status = 'accepted'$$, 'direct friendship update is blocked');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select public.respond_friend('00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) = 0 from public.friendships), 'C declining removes the request');
select pg_temp.ok((select count(*) = 1 from public.profiles), 'after declining, C no longer sees A');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select public.respond_friend('00000000-0000-0000-0000-00000000000a', true);
select pg_temp.ok((select status = 'accepted' from public.friendships where user_id::text like '%a'), 'D accepts A');
select pg_temp.ok(public.request_friend(pg_temp.code('b')) = 'pending', 'D -> B request');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.respond_friend('00000000-0000-0000-0000-00000000000d', true);
reset role;

-- ---------------------------------------------------------------------- rounds
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.rounds (course_id, nines, tee_time, last_lat, last_lng, last_fix_at)
  values ('redhawk', array['Creek','Oaks'], now() - interval '90 minutes', 33.468, -117.092, now());
select pg_temp.ok((select nines is null from public.rounds), 'nines ignored for an 18-hole course');
select pg_temp.fails($$insert into public.rounds (course_id, tee_time) values ('redhawk', now())$$, 'only one live round per golfer');
select pg_temp.fails($$insert into public.rounds (user_id, course_id, tee_time) values ('00000000-0000-0000-0000-00000000000c', 'redhawk', now())$$,
  'cannot start a round as someone else');
update public.rounds set hole = 7, hole_started_at = now();
select pg_temp.ok((select mode = 'riding' from public.rounds), 'mode defaults to riding');
update public.rounds set mode = 'walking';
select pg_temp.ok((select mode = 'walking' from public.rounds), 'owner can switch to walking mid-round');
select pg_temp.fails($$update public.rounds set mode = 'jogging'$$, 'mode must be walking or riding');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.rounds where hole = 7), 'friend B sees A''s live round');
select pg_temp.ok((select last_lat is not null from public.rounds), 'friend sees live position');
update public.rounds set hole = 18;
select pg_temp.ok((select hole = 7 from public.rounds), 'friend cannot move A''s round');
select pg_temp.ok((select mode = 'walking' from public.rounds), 'friend sees A is walking');
update public.rounds set mode = 'riding';
select pg_temp.ok((select mode = 'walking' from public.rounds), 'friend cannot change A''s mode');
delete from public.rounds;
reset role;
select pg_temp.ok((select count(*) = 1 from public.rounds), 'friend cannot delete A''s round');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.rounds), 'stranger C sees no rounds');
select pg_temp.fails($$insert into public.rounds (course_id, nines, tee_time) values ('temecula-creek-inn', array['Creek','Creek'], now())$$,
  'same nine twice rejected');
select pg_temp.fails($$insert into public.rounds (course_id, tee_time) values ('temecula-creek-inn', now())$$, '27-hole course needs nines');
insert into public.rounds (course_id, nines, tee_time) values ('temecula-creek-inn', array['Oaks','Creek'], now());
select pg_temp.ok((select count(*) = 1 from public.rounds), 'C starts a Temecula Creek round (Oaks/Creek)');
select pg_temp.fails($$update public.rounds set nines = array['Creek','Stone House']$$, 'nines locked after start');
reset role;

-- Finish: coordinates wiped, still visible to friends for 4h.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
update public.rounds set status = 'done' where status = 'live';
select pg_temp.ok((select finished_at is not null and last_lat is null and last_lng is null and last_fix_at is null from public.rounds),
  'finish stamps finished_at and wipes coordinates');
select pg_temp.fails($$update public.rounds set status = 'live'$$, 'finished round cannot restart');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.rounds where status = 'done'), 'friend still sees a just-finished round');
reset role;
update public.rounds set finished_at = now() - interval '5 hours' where user_id::text like '%a';
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.rounds), 'finished round hidden after 4h');
reset role;

-- Selected visibility: D shares with A only; B (also D's friend) must not see it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
insert into public.rounds (course_id, tee_time, visibility) values ('redhawk', now(), 'selected');
insert into public.round_viewers select id, '00000000-0000-0000-0000-00000000000a' from public.rounds;
select pg_temp.fails($$insert into public.round_viewers select id, '00000000-0000-0000-0000-00000000000c' from public.rounds$$,
  'cannot list a non-friend as viewer');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.rounds where user_id::text like '%d'), 'listed viewer A sees D''s selected round');
select pg_temp.fails($$insert into public.round_viewers select id, '00000000-0000-0000-0000-00000000000b' from public.rounds where user_id::text like '%d'$$,
  'only the owner can add viewers');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.rounds where user_id::text like '%d'), 'unlisted friend B does not see D''s selected round');
reset role;

-- Unfriend: B removes A, then can't see A's new round.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.rounds (course_id, tee_time) values ('redhawk', now());
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.rounds where user_id::text like '%a'), 'B sees A''s new round');
delete from public.friendships where user_id::text like '%a' or friend_id::text like '%a';
select pg_temp.ok((select count(*) = 0 from public.rounds where user_id::text like '%a'), 'after unfriending, B no longer sees A');
reset role;

-- Stale live rounds: hidden after 6h, then closed out by the cron job.
set session_replication_role = replica;  -- bypass rounds_guard to age the fixture
update public.rounds set updated_at = now() - interval '7 hours', last_lat = 33.4, last_lng = -117.1
 where user_id::text like '%d';
set session_replication_role = origin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.rounds where user_id::text like '%d'), 'stale (6h) live round hidden from viewers');
select pg_temp.fails($$select public.expire_stale_rounds()$$, 'clients cannot run the expiry job');
reset role;
select pg_temp.ok(public.expire_stale_rounds() = 1, 'expiry job closes exactly the stale round');
select pg_temp.ok((select status = 'done' and last_lat is null from public.rounds where user_id::text like '%d'), 'expired round is done with coordinates wiped');

-- ------------------------------------------------------------------ anon / courses
set role anon;
select pg_temp.fails($$select 1 from public.request_friend('AAAAAA')$$, 'anon cannot call friend RPCs');
select pg_temp.ok((select count(*) = 0 from public.rounds), 'anon sees no rounds');
select pg_temp.ok((select count(*) = 0 from public.courses), 'anon sees no courses');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok((select count(*) = 2 from public.courses), 'signed-in users read courses');
select pg_temp.fails($$insert into public.courses (id, name, data) values ('x', 'x', '{}')$$, 'clients cannot write courses');
select pg_temp.fails($$select * from public.share_links$$ || ' where false; insert into public.share_links (round_id, expires_at) select id, now() from public.rounds',
  'clients cannot create share links');
reset role;

\warn 'All RLS tests passed.'
