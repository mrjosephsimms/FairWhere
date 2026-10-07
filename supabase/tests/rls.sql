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
select pg_temp.ok((select count(*) >= 2 from public.courses)
  and exists (select 1 from public.courses where id = 'redhawk')
  and exists (select 1 from public.courses where id = 'temecula-creek-inn'), 'courses seeded (Redhawk, Temecula Creek and more)');
select pg_temp.ok((select bool_and(jsonb_array_length(data->'holes') >= 18 and data->>'id' = id
                                   and (nines is null) = (jsonb_typeof(data->'nines') = 'null')) from public.courses),
  'every seeded course has its holes and matching id / nines');

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
update public.rounds set searching_since = now() - interval '4 minutes';
select set_config('test.a_round', (select id::text from public.rounds), false);
insert into public.round_scores (round_id, hole, strokes) select id, 1, 5 from public.rounds;
insert into public.round_scores (round_id, hole, strokes) select id, 2, 4 from public.rounds
  on conflict (round_id, hole) do update set strokes = excluded.strokes;
update public.round_scores set strokes = 3 where hole = 2;
select pg_temp.ok((select sum(strokes) = 8 from public.round_scores), 'owner keeps score (insert, upsert, edit)');
select pg_temp.fails($$insert into public.round_scores (round_id, hole, strokes) select id, 3, 0 from public.rounds$$, 'strokes must be 1..20');
select pg_temp.fails($$insert into public.round_scores (round_id, hole, strokes) select id, 19, 4 from public.rounds$$, 'hole must be 1..18');
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
select pg_temp.ok((select searching_since is not null from public.rounds), 'friend sees A is hunting for a ball');
update public.rounds set searching_since = null;
select pg_temp.ok((select searching_since is not null from public.rounds), 'friend cannot clear A''s ball hunt');
select pg_temp.ok((select sum(strokes) = 8 from public.round_scores), 'friend sees A''s scorecard');
insert into public.game_plays (round_id, hole, strokes) select id, 2, 3 from public.rounds;
select pg_temp.ok((select count(*) = 1 and bool_and(player_id = '00000000-0000-0000-0000-00000000000b') from public.game_plays),
  'friend B plays A''s hole 2 and the play is B''s');
select pg_temp.fails($$insert into public.game_plays (round_id, hole, player_id, strokes)
  select id, 2, '00000000-0000-0000-0000-00000000000d', 3 from public.rounds$$, 'cannot record a play as someone else');
select pg_temp.fails($$update public.game_plays set strokes = 1$$, 'plays cannot be edited');
select pg_temp.fails($$insert into public.game_plays (round_id, hole, strokes) select id, 2, 11 from public.rounds$$, 'game strokes capped at 10');
select pg_temp.fails($$insert into public.round_scores (round_id, hole, strokes) select id, 5, 9 from public.rounds$$,
  'friend cannot write on A''s scorecard');
update public.round_scores set strokes = 1;
delete from public.round_scores;
delete from public.rounds;
reset role;
select pg_temp.ok((select count(*) = 1 from public.rounds), 'friend cannot delete A''s round');
select pg_temp.ok((select sum(strokes) = 8 from public.round_scores), 'friend could not change or delete A''s scores');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.rounds), 'stranger C sees no rounds');
select pg_temp.ok((select count(*) = 0 from public.round_scores), 'stranger C sees no scorecards');
select pg_temp.ok((select count(*) = 0 from public.game_plays), 'stranger C sees no game plays');
select pg_temp.fails($$insert into public.game_plays (round_id, hole, strokes)
  values (current_setting('test.a_round')::uuid, 2, 4)$$, 'stranger C cannot play A''s round');
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
select pg_temp.ok((select count(*) = 1 from public.game_plays), 'A sees friends'' plays on their round');
update public.rounds set status = 'done' where status = 'live';
select pg_temp.ok((select finished_at is not null and last_lat is null and last_lng is null and last_fix_at is null from public.rounds),
  'finish stamps finished_at and wipes coordinates');
select pg_temp.ok((select searching_since is null from public.rounds), 'finish clears the ball hunt');
select pg_temp.fails($$update public.rounds set status = 'live'$$, 'finished round cannot restart');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.rounds where status = 'done'), 'friend still sees a just-finished round');
reset role;
update public.rounds set finished_at = now() - interval '5 hours' where user_id::text like '%a';
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.rounds), 'finished round hidden after 4h');
select pg_temp.ok((select count(*) = 1 from public.game_plays), 'B still sees their own hole-game play after the round is hidden');
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
select pg_temp.ok((select count(*) >= 2 from public.courses)
  and (select count(*) = 2 from public.courses where id in ('redhawk', 'temecula-creek-inn')), 'signed-in users read courses');
select pg_temp.ok((select bool_and(jsonb_array_length(features->'bunkers') > 0 and jsonb_array_length(features->'water') > 0)
                   from public.courses where id in ('redhawk', 'temecula-creek-inn')),
  'signed-in users read mapped course features (bunkers, water)');
select pg_temp.fails($$insert into public.courses (id, name, data) values ('x', 'x', '{}')$$, 'clients cannot write courses');
select pg_temp.fails($$select * from public.share_links$$ || ' where false; insert into public.share_links (round_id, expires_at) select id, now() from public.rounds',
  'clients cannot create share links');
reset role;

-- Usernames, @-adds, and profile photos.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
update public.profiles set username = 'cara.golf' where id = auth.uid();
select pg_temp.ok((select username = 'cara.golf' from public.profiles where id = auth.uid()), 'set my @username');
select pg_temp.fails($$update public.profiles set username = 'No Spaces!' where id = auth.uid()$$, 'username format enforced');
update public.profiles set username = 'hijack' where id = '00000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.ok((select username is null from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'cannot set someone else''s username');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select pg_temp.fails($$update public.profiles set username = 'cara.golf' where id = auth.uid()$$, 'usernames are unique');
select pg_temp.ok((select public.request_friend('@Cara.Golf') = 'pending'), 'add a friend by @username (any case)');
select pg_temp.fails($$select public.request_friend('@nobody.here')$$, 'unknown @username rejected');
insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000d/me.jpg');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000a/me.jpg')$$,
  'cannot upload into someone else''s photo folder');
reset role;
select pg_temp.ok((select count(*) = 1 from storage.objects), 'own profile photo uploaded');

-- Alerts: watches, the SQL pace model, and notifications from round changes + the minute job.
reset role;
delete from public.rounds;
delete from public.friendships where least(user_id, friend_id) = '00000000-0000-0000-0000-00000000000a' and greatest(user_id, friend_id) = '00000000-0000-0000-0000-00000000000b';
insert into public.friendships (user_id, friend_id, status) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
insert into public.watches (golfer_id, holes, before_finish_min, tee_off, finished, ball_hunt)
  values ('00000000-0000-0000-0000-00000000000a', '{9,18}', 30, true, true, true);
select pg_temp.fails($$insert into public.watches (golfer_id, every_hole) values ('00000000-0000-0000-0000-00000000000c', true)$$, 'can only watch a friend');
select pg_temp.fails($$update public.watches set holes = '{19}'$$, 'holes must be 1..18');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.watches where golfer_id = auth.uid()), 'golfer sees who gets updates about them');
insert into public.rounds (course_id, tee_time) values ('redhawk', now() - interval '150 minutes');
update public.rounds set hole = 11, hole_started_at = now() - interval '5 minutes';
-- Same case as app/src/lib/pace.test.ts "matches the reference": 108 min left, 2 min behind.
select pg_temp.ok((select round(extract(epoch from e.eta - now()) / 60) = 108 and round(e.delta_min) = 2
  from public.rounds r, public.round_eta(r) e), 'SQL pace model matches the app (108 min left, +2)');
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(kind = 'hole' and hole = 9 and eta is not null and user_id = '00000000-0000-0000-0000-00000000000b') from public.notifications),
  'jumping 1 -> 11 sends exactly the picked hole (9), with an ETA');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
update public.rounds set hole = 12, hole_started_at = now();
select pg_temp.ok((select count(*) = 0 from public.notifications), 'golfer never sees the alerts sent to others');
update public.rounds set searching_since = now() - interval '3 minutes';
reset role;
select pg_temp.ok((select count(*) = 2 and count(*) filter (where kind = 'ball_hunt') = 1 from public.notifications), 'ball hunt alert (and nothing for unpicked hole 11)');
select public.notify_tick();
select public.notify_tick();
select pg_temp.ok((select count(*) filter (where kind = 'tee_off') = 1 and count(*) filter (where kind = 'soon') = 0 from public.notifications),
  'minute job: teed off once (run twice), not yet 30 min out');
set session_replication_role = replica; -- jump them to the 18th, nearly done
update public.rounds set hole = 18, hole_started_at = now() - interval '12 minutes', hole_fraction = 0.8;
set session_replication_role = origin;
select public.notify_tick();
select pg_temp.ok((select count(*) filter (where kind = 'soon') = 1 from public.notifications), 'about 30 min from done');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.round_scores (round_id, hole, strokes) select id, 1, 6 from public.rounds;
update public.rounds set status = 'done';
reset role;
select pg_temp.ok((select strokes = 6 from public.notifications where kind = 'finished'), 'finished alert carries their score');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 5 from public.notifications), 'recipient sees their alerts');
update public.notifications set read_at = now();
select pg_temp.ok((select bool_and(read_at is not null) from public.notifications), 'recipient can mark alerts read');
select pg_temp.fails($$update public.notifications set kind = 'soon'$$, 'alerts cannot be edited beyond read');
select pg_temp.fails($$insert into public.notifications (user_id, golfer_id, round_id, kind) select '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', id, 'soon' from public.rounds$$,
  'clients cannot create alerts');
select pg_temp.fails($$select public.notify_tick()$$, 'clients cannot run the alert job');
reset role;

-- Push (step 3): phones, the nudge to the sender, and claiming alerts exactly once.
select pg_temp.ok((select count(*) > 0 from net.calls where url like '%/functions/v1/push'), 'new alerts nudge the push sender');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.register_device(repeat('ab', 32), 'America/New_York');
select pg_temp.ok((select count(*) = 1 and bool_and(tz = 'America/New_York') from public.device_tokens), 'register my phone (with its time zone)');
select public.register_device(upper(repeat('ab', 32)), 'Not/AZone');
select pg_temp.ok((select count(*) = 1 and bool_and(tz = 'America/Los_Angeles') from public.device_tokens), 're-register: same phone, unknown zone falls back');
select pg_temp.fails($$select public.register_device('not-a-token')$$, 'device tokens must be hex');
select pg_temp.fails($$insert into public.device_tokens (token) values (repeat('cd', 32))$$, 'phones register through register_device only');
select pg_temp.fails($$select * from public.claim_pushes()$$, 'clients cannot claim pushes');
select pg_temp.fails($$select public.push_feedback(repeat('ab', 32), 'sandbox', true)$$, 'clients cannot report on tokens');
select pg_temp.fails($$select public.kick_push()$$, 'clients cannot nudge the sender');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.device_tokens), 'nobody else sees my phone');
delete from public.device_tokens;
reset role;
select pg_temp.ok((select count(*) = 1 from public.device_tokens), 'nobody else can remove my phone');
-- Bob turns "finished" off after that alert was made: the sender must skip it.
update public.watches set finished = false where watcher_id = '00000000-0000-0000-0000-00000000000b';
set role service_role;
select pg_temp.ok((select count(*) = 4 and bool_and(token = repeat('ab', 32)) and not bool_or(kind = 'finished')
                          and bool_and(golfer_name like 'Sunny%') and bool_and(course_name = 'Redhawk Golf Club') and bool_and(tz = 'America/Los_Angeles')
                   from public.claim_pushes()), 'sender gets each wanted alert for each phone, not the one turned off');
select pg_temp.ok((select count(*) = 0 from public.claim_pushes()), 'a claimed alert is never sent twice');
reset role;
select pg_temp.ok((select bool_and(pushed_at is not null) from public.notifications), 'every claimed alert is stamped pushed');
set role service_role;
select public.push_feedback(repeat('ab', 32), 'sandbox', false);
reset role;
select pg_temp.ok((select env = 'sandbox' from public.device_tokens), 'sender records which APNs environment a phone uses');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select public.register_device(repeat('ab', 32), 'America/Los_Angeles');
reset role;
select pg_temp.ok((select user_id = '00000000-0000-0000-0000-00000000000d' and env is null from public.device_tokens), 'a phone signed into another account moves over');
set role service_role;
select public.push_feedback(repeat('ab', 32), null, true);
reset role;
select pg_temp.ok((select count(*) = 0 from public.device_tokens), 'dead tokens are removed');
update public.watches set finished = true where watcher_id = '00000000-0000-0000-0000-00000000000b';

-- Everyday location sharing (off by default, owner grants per person) and the gone-home backup.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.locations (lat, lng, accuracy) values (33.50, -117.15, 12);
select pg_temp.fails($$insert into public.locations (user_id, lat, lng) values ('00000000-0000-0000-0000-00000000000b', 1, 1)$$, 'cannot write someone else''s location');
select pg_temp.fails($$insert into public.location_shares (viewer_id) values ('00000000-0000-0000-0000-00000000000c')$$, 'can only share location with a friend');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.locations), 'by default a friend cannot see your everyday location');
select pg_temp.fails($$insert into public.location_shares (owner_id, viewer_id) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')$$, 'nobody can grant themselves access to someone');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.location_shares (viewer_id, expires_at) values ('00000000-0000-0000-0000-00000000000b', now() + interval '1 hour');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.locations where user_id = '00000000-0000-0000-0000-00000000000a'), 'friend sees it once you share with them');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.locations), 'nobody else does');
reset role;
update public.location_shares set expires_at = now() - interval '1 minute';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.locations), 'an expired share shows nothing');
reset role;
select public.notify_tick();
select pg_temp.ok((select count(*) = 0 from public.location_shares) and (select count(*) = 0 from public.locations),
  'minute job ends expired shares and forgets the position');

-- Gone home without finishing: a fresh fix 2+ km away ends the round; on the course it doesn't.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.rounds (course_id, tee_time, last_lat, last_lng, last_fix_at) values ('redhawk', now() - interval '2 hours', 33.468, -117.092, now());
reset role;
select public.notify_tick();
select pg_temp.ok(exists (select 1 from public.rounds where user_id = '00000000-0000-0000-0000-00000000000a' and status = 'live'), 'a round with the golfer on the course keeps going');
select pg_temp.ok((select public.metres_from_course('redhawk', 33.468083, -117.09208) < 5), 'distance to the course is ~0 on the 1st tee');
set session_replication_role = replica;
update public.rounds set last_lat = 33.60, last_lng = -117.20, last_fix_at = now() - interval '2 minutes' where user_id = '00000000-0000-0000-0000-00000000000a' and status = 'live';
set session_replication_role = origin;
select public.notify_tick();
select pg_temp.ok(not exists (select 1 from public.rounds where user_id = '00000000-0000-0000-0000-00000000000a' and (status = 'live' or last_lat is not null)), 'left the course (2+ km away): round finished, location wiped');

-- Home course (Edit profile).
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
update public.profiles set home_course_id = 'redhawk' where id = auth.uid();
select pg_temp.ok((select home_course_id = 'redhawk' from public.profiles where id = auth.uid()), 'set my home course');
select pg_temp.fails($$update public.profiles set home_course_id = 'not-a-course' where id = auth.uid()$$, 'home course must be a real course');
update public.profiles set home_course_id = 'redhawk' where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.ok((select home_course_id is null from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'cannot set someone else''s home course');

-- App Review (step 4): block, report, delete account.
reset role;
delete from public.friendships;
insert into public.friendships (user_id, friend_id, status) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted'), ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'accepted'), ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d', 'accepted');
insert into public.watches (watcher_id, golfer_id, tee_off) values ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', true) on conflict do nothing;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.block_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) = 0 from public.friendships where '00000000-0000-0000-0000-00000000000d' in (user_id, friend_id)), 'blocking removes the friendship');
select pg_temp.ok((select count(*) = 0 from public.profiles where id = '00000000-0000-0000-0000-00000000000d'), 'blocker no longer sees them');
select pg_temp.ok((select count(*) = 1 and bool_and(id = '00000000-0000-0000-0000-00000000000d') from public.my_blocks()), 'blocked people listed (with names) to unblock');
select pg_temp.fails($$select public.block_user(auth.uid())$$, 'cannot block yourself');
select pg_temp.fails($$insert into public.blocks (blocked_id) values ('00000000-0000-0000-0000-00000000000c')$$, 'blocks only through block_user');
reset role;
select pg_temp.ok((select count(*) = 0 from public.watches where watcher_id = '00000000-0000-0000-0000-00000000000d' and golfer_id = '00000000-0000-0000-0000-00000000000a'), 'their alerts about you stop');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'blocked person no longer sees the blocker');
select pg_temp.ok((select count(*) = 0 from public.blocks), 'blocked person cannot see the block');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
do $$ begin
  perform public.request_friend((select friend_code from public.profiles p where p.id = '00000000-0000-0000-0000-00000000000a'));
  raise exception 'FAIL: blocked person could send a request';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm <> 'No golfer has that code or username' then raise exception 'FAIL: block revealed: %', sqlerrm; end if;
  raise notice 'ok   blocked person cannot send a request (sees "not found", block not revealed)';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
delete from public.blocks where blocked_id = '00000000-0000-0000-0000-00000000000d';
reset role;
select pg_temp.ok(not public.is_blocked_between('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d'), 'unblocking lifts the block');

-- Reports
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.report_user('00000000-0000-0000-0000-00000000000a', 'photo', '  not a golf photo  ');
select pg_temp.fails($$select * from public.reports$$, 'reports are not readable by users');
select pg_temp.fails($$select public.report_user('00000000-0000-0000-0000-00000000000c', 'spam')$$, 'cannot report a stranger');
select pg_temp.fails($$select public.report_user('00000000-0000-0000-0000-00000000000a', 'mean')$$, 'report reasons are a fixed list');
select public.report_user('00000000-0000-0000-0000-00000000000d', 'harassment', null, true);
reset role;
select pg_temp.ok((select count(*) = 2 from public.reports), 'reports stored');
select pg_temp.ok((select reported_name like 'Sunny%' and details = 'not a golf photo' and reporter_id = '00000000-0000-0000-0000-00000000000b' from public.reports where reason = 'photo'),
  'report keeps a snapshot of who and why');
select pg_temp.ok(public.is_blocked_between('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d') and not exists (select 1 from public.friendships where '00000000-0000-0000-0000-00000000000d' in (user_id, friend_id) and '00000000-0000-0000-0000-00000000000b' in (user_id, friend_id)),
  'report and block in one step');

-- Delete account (Apple 5.1.1(v)): everything of theirs goes; everyone else stays.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.register_device(repeat('ef', 32), 'America/Los_Angeles');
select public.delete_my_account();
reset role;
select pg_temp.ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000b') and not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'delete account removes the sign-in and profile');
select pg_temp.ok(not exists (select 1 from public.friendships where '00000000-0000-0000-0000-00000000000b' in (user_id, friend_id))
             and not exists (select 1 from public.watches where '00000000-0000-0000-0000-00000000000b' in (watcher_id, golfer_id))
             and not exists (select 1 from public.notifications where '00000000-0000-0000-0000-00000000000b' in (user_id, golfer_id))
             and not exists (select 1 from public.device_tokens where user_id = '00000000-0000-0000-0000-00000000000b')
             and not exists (select 1 from public.blocks where '00000000-0000-0000-0000-00000000000b' in (blocker_id, blocked_id))
             and not exists (select 1 from public.rounds where user_id = '00000000-0000-0000-0000-00000000000b'), 'and all their friendships, alerts, phones, blocks and rounds');
select pg_temp.ok((select reporter_id is null and reported_name like 'Sunny%' from public.reports where reason = 'photo'), 'their reports stay (anonymised) for review');
select pg_temp.ok(exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000a') and exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000d'), 'other people are untouched');
select pg_temp.act_as('');
set role authenticated;
select pg_temp.fails($$select public.delete_my_account()$$, 'deleting needs a signed-in user');
reset role;

-- Step 6: rate limits, photo cap, job-log upkeep.
reset role;
select pg_temp.ok((select file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg'] from storage.buckets where id = 'avatars'),
  'profile photos capped at 2 MB, JPEG only');
insert into cron.job_run_details (end_time) values (now() - interval '8 days'), (now() - interval '1 day');
select public.trim_job_logs();
select pg_temp.ok((select count(*) = 1 from cron.job_run_details), 'job logs older than a week are trimmed');
-- 20 requests in an hour from C: the 21st is refused (with a readable message).
insert into auth.users (id, email) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'spam' || g || '@example.com' from generate_series(1, 21) g;
insert into public.friendships (user_id, friend_id, created_at)
  select '00000000-0000-0000-0000-00000000000c', ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, now() - interval '10 minutes' from generate_series(1, 20) g;
select set_config('test.code21', (select friend_code from public.profiles where id = '00000000-0000-0000-0001-000000000021'), false);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
do $$ begin
  perform public.request_friend(current_setting('test.code21'));
  raise exception 'FAIL: 21st request in an hour went through';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%a lot of requests%' then raise exception 'FAIL: wrong error: %', sqlerrm; end if;
  raise notice 'ok   friend requests limited (20 an hour)';
end $$;
reset role;
update public.friendships set created_at = now() - interval '2 hours' where user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok(public.request_friend(current_setting('test.code21')) = 'pending',
  'the hourly limit resets');
reset role;
-- Reports: one per person per day, at most 10 a day.
insert into public.friendships (user_id, friend_id, status) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'accepted') on conflict do nothing;
delete from public.reports;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.report_user('00000000-0000-0000-0000-00000000000d', 'spam');
select public.report_user('00000000-0000-0000-0000-00000000000d', 'spam', 'again');
reset role;
select pg_temp.ok((select count(*) = 1 from public.reports), 'a repeat report of the same person the same day is not stored twice');
insert into public.reports (reporter_id, reported_id, reason) select '00000000-0000-0000-0000-00000000000a', null, 'other' from generate_series(1, 9);
delete from public.friendships where least(user_id, friend_id) = '00000000-0000-0000-0000-00000000000a' and greatest(user_id, friend_id) = '00000000-0000-0000-0000-00000000000c';
insert into public.friendships (user_id, friend_id, status) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'accepted');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
do $$ begin
  perform public.report_user('00000000-0000-0000-0000-00000000000c', 'spam');
  raise exception 'FAIL: 11th report in a day went through';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%a lot of reports%' then raise exception 'FAIL: wrong error: %', sqlerrm; end if;
  raise notice 'ok   reports limited (10 a day)';
end $$;
reset role;

\warn 'All RLS tests passed.'
