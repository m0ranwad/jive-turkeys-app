-- Game reminder database tests: a set time before kickoff (6 hours unless
-- changed), Active players who haven't answered are asked "Are you in?", and
-- when we're short, Sub Pool and On Break players who haven't said OUT are
-- asked to sub. The headcount matches the site's (headcount() in
-- src/lib/team-logic.js). Run by scripts/test-db.sh; everything is rolled
-- back. now() is fixed for the whole transaction, so the clock is acted out by
-- moving the game. The first failed check stops the run with "FAILED: ...".

begin;

reset role;
select set_config('request.jwt.claim.sub', '', false);

create schema rem_test;
grant usage on schema rem_test to authenticated, anon;
create table rem_test.people (name text primary key, id uuid not null);
grant select on rem_test.people to authenticated, anon;

create function rem_test.id(who text) returns uuid language sql stable as $$
  select id from rem_test.people where name = who;
$$;

create function rem_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function rem_test.refused(statement text, what text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice 'ok - % (refused: %)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (it was allowed)', what;
end;
$$;

grant execute on all functions in schema rem_test to authenticated, anon;

create function rem_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', rem_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- Whose phones a set of subscriptions belongs to (our test phones only), as names.
create function rem_test.names(subscription_ids uuid[]) returns text[] language sql as $$
  select coalesce(array_agg(p.name order by p.name), '{}')
  from public.push_subscriptions s join rem_test.people p on p.id = s.user_id
  where s.id = any (subscription_ids);
$$;

-- Requests the database asked notify-chat to make for a game, as kinds.
create function rem_test.sent(game uuid) returns text[] language sql as $$
  select coalesce(array_agg(body ->> 'kind' order by id), '{}') from net.test_requests where body ->> 'reminder_game_id' = game::text;
$$;


-- ---------------------------------------------------------------------------
-- Kickoff times are read the way captains type them, in Eastern time.
-- ---------------------------------------------------------------------------

select rem_test.ok(public.game_kickoff('2026-10-15', '19:00') = '2026-10-15 19:00 America/New_York'::timestamptz, 'reads "19:00"');
select rem_test.ok(public.game_kickoff('2026-10-15', '7:00 PM') = '2026-10-15 19:00 America/New_York'::timestamptz, 'reads "7:00 PM"');
select rem_test.ok(public.game_kickoff('2026-12-03', '8:10pm') = '2026-12-03 20:10 America/New_York'::timestamptz, 'reads "8:10pm", in winter time too');
select rem_test.ok(public.game_kickoff('2026-10-15', '12:30 AM') = '2026-10-15 00:30 America/New_York'::timestamptz, 'reads "12:30 AM"');
select rem_test.ok(public.game_kickoff('2026-10-15', 'TBD') is null and public.game_kickoff('2026-10-15', null) is null,
  'no time, no kickoff (and no reminder)');

-- ---------------------------------------------------------------------------
-- The team: Ann, Bea (women) and Cal, Dan (men) are Active; Sid (man) and
-- Sue (woman) are in the sub pool; Ray (man) is on break. Mo is a roster name
-- who hasn't joined. Everyone with an account turned notifications on.
-- ---------------------------------------------------------------------------

reset role;
delete from public.team_settings;
delete from public.session_roster;
insert into rem_test.people values
  ('ann', '00000000-0000-4000-8000-0000000000e1'), ('bea', '00000000-0000-4000-8000-0000000000e2'),
  ('cal', '00000000-0000-4000-8000-0000000000e3'), ('dan', '00000000-0000-4000-8000-0000000000e4'),
  ('sid', '00000000-0000-4000-8000-0000000000e5'), ('sue', '00000000-0000-4000-8000-0000000000e6'),
  ('ray', '00000000-0000-4000-8000-0000000000e7'), ('mo', '00000000-0000-4000-8000-0000000000e8'),
  ('g1', '00000000-0000-4000-8000-0000000000f1');
insert into auth.users (id, email) select id, name || '@rem.test' from rem_test.people where name not in ('mo', 'g1');
update public.users set joined_team_at = now() where id in (select id from rem_test.people);
insert into public.player_profiles (user_id, display_name, gender, status) values
  (rem_test.id('ann'), 'Ann', 'F', 'active'), (rem_test.id('bea'), 'Bea', 'F', 'active'),
  (rem_test.id('cal'), 'Cal', 'M', 'active'), (rem_test.id('dan'), 'Dan', 'M', 'active'),
  (rem_test.id('sid'), 'Sid', 'M', 'sub_pool'), (rem_test.id('sue'), 'Sue', 'F', 'sub_pool'),
  (rem_test.id('ray'), 'Ray', 'M', 'on_break');
insert into public.team_guests (id, display_name, gender, status) values (rem_test.id('mo'), 'Mo', 'M', 'active');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test/rem-' || name, 'k', 'a' from rem_test.people where name not in ('mo', 'g1');
-- Thursday's game, 5 hours from now (inside the 6-hour window).
insert into public.games (id, season_year, session, date, time, field_number, opponent)
  select rem_test.id('g1'), 2031, 1, (now() + interval '5 hours') at time zone 'America/New_York',
    to_char((now() + interval '5 hours') at time zone 'America/New_York', 'FMHH12:MI AM'), '2', 'Ball Busters';
-- Ann and Cal are IN, Ann in goal; Bea says MAYBE; Mo (roster name) is IN; Dan hasn't answered.
insert into public.rsvps (game_id, user_id, status, playing_gk) values
  (rem_test.id('g1'), rem_test.id('ann'), 'in', true),
  (rem_test.id('g1'), rem_test.id('cal'), 'in', false),
  (rem_test.id('g1'), rem_test.id('bea'), 'maybe', false),
  (rem_test.id('g1'), rem_test.id('ray'), 'out', false);
insert into public.rsvps (game_id, guest_id, status) values (rem_test.id('g1'), rem_test.id('mo'), 'in');

-- ---------------------------------------------------------------------------
-- The headcount, as the site shows it: 3 in (Ann, Cal, Mo), no women on the
-- field (Ann is in goal), so short 5 players (8 minimum) and 3 women.
-- ---------------------------------------------------------------------------

select rem_test.ok(
  (select total_in = 3 and women_field_in = 0 and need_total = 5 and need_women = 3 from public.game_headcount(rem_test.id('g1'))),
  'the headcount matches the site''s: a woman in goal doesn''t count toward the women');

-- ---------------------------------------------------------------------------
-- 5 hours before kickoff: both reminders go out, once each.
-- ---------------------------------------------------------------------------

select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) = '{rsvp,subs}', 'inside the window, both reminders are asked for');

create temp table rsvp_sent as select * from public.game_reminder_targets(rem_test.id('g1'), 'rsvp');
select rem_test.ok(rem_test.names(array(select subscription_id from rsvp_sent)) = '{dan}',
  '"Are you in?" goes to Active players who haven''t answered (not MAYBE, not subs, not on break)');
select rem_test.ok(
  (select bool_and(title = '⚽ Are you in?' and body ~ '^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M vs Ball Busters, Field 2\. You haven''t answered yet\.'
     and url = '/games/' || rem_test.id('g1')) from rsvp_sent),
  'it says when, who against and the field, and opens the game');

create temp table subs_sent as select * from public.game_reminder_targets(rem_test.id('g1'), 'subs');
select rem_test.ok(rem_test.names(array(select subscription_id from subs_sent)) = '{sid,sue}',
  'the call for subs goes to the sub pool, not to someone on break who said OUT');
select rem_test.ok(
  (select bool_and(title = '🆘 We need subs' and body like 'We need 5 more players (3 women) for % vs Ball Busters, Field 2. Can you play?%') from subs_sent),
  'it says how many we need, and how many women');

select rem_test.ok((select count(*) = 0 from public.game_reminder_targets(rem_test.id('g1'), 'rsvp')), 'each goes out once');
select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) = '{rsvp,subs}', 'and the timer doesn''t ask again');

-- ---------------------------------------------------------------------------
-- Only women short: only women are asked.
-- ---------------------------------------------------------------------------

delete from public.game_reminder_log;
delete from net.test_requests;
insert into public.team_settings (min_players, min_women) values (3, 1);
select rem_test.ok(
  (select need_total = 0 and need_women = 1 from public.game_headcount(rem_test.id('g1'))),
  'captains'' minimums count (3 players, 1 woman)');
create temp table women_sent as select * from public.game_reminder_targets(rem_test.id('g1'), 'subs');
select rem_test.ok(rem_test.names(array(select subscription_id from women_sent)) = '{sue}', 'short only on women: only women are asked');
select rem_test.ok((select bool_and(body like 'We need 1 more woman for %') from women_sent), 'and it says so');

-- Not short: no call for subs, even later on.
delete from public.game_reminder_log;
update public.rsvps set playing_gk = false where user_id = rem_test.id('ann');
select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) = '{rsvp}', 'not short: no call for subs');
-- The sender picks the reminder up (it marks it as gone out).
select count(*) from public.game_reminder_targets(rem_test.id('g1'), 'rsvp');
-- Ann drops out an hour before: now we're short, and the subs are asked.
update public.rsvps set status = 'out' where user_id = rem_test.id('ann');
select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) = '{rsvp,subs}', 'someone drops out later: then the subs are asked');

-- ---------------------------------------------------------------------------
-- Timing, settings and choices.
-- ---------------------------------------------------------------------------

delete from public.game_reminder_log;
delete from net.test_requests;
update public.games set date = (now() + interval '7 hours') at time zone 'America/New_York',
  time = to_char((now() + interval '7 hours') at time zone 'America/New_York', 'HH24:MI') where id = rem_test.id('g1');
select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) = '{}', '7 hours before kickoff: too early');
update public.team_settings set game_reminder_hours = 8;
select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) @> '{rsvp}', 'captains set how long before (8 hours)');

delete from public.game_reminder_log;
delete from net.test_requests;
update public.team_settings set game_reminders = false;
select public.game_reminders_tick();
select rem_test.ok(rem_test.sent(rem_test.id('g1')) = '{}', 'captains can turn reminders off');
update public.team_settings set game_reminders = true;

update public.player_profiles set notify_games = false where user_id = rem_test.id('dan');
select rem_test.ok((select count(*) = 0 from public.game_reminder_targets(rem_test.id('g1'), 'rsvp')),
  'players who turned Game alerts off don''t get them');
update public.player_profiles set notify_games = true where user_id = rem_test.id('dan');
delete from public.game_reminder_log;

update public.games set date = (now() - interval '1 hour') at time zone 'America/New_York',
  time = to_char((now() - interval '1 hour') at time zone 'America/New_York', 'HH24:MI') where id = rem_test.id('g1');
select rem_test.ok((select count(*) = 0 from public.game_reminder_targets(rem_test.id('g1'), 'rsvp')), 'nothing after kickoff');
update public.games set date = (now() + interval '2 hours') at time zone 'America/New_York',
  time = to_char((now() + interval '2 hours') at time zone 'America/New_York', 'HH24:MI'), has_result = true where id = rem_test.id('g1');
select rem_test.ok((select count(*) = 0 from public.game_reminder_targets(rem_test.id('g1'), 'rsvp')), 'or for a game with a result');

-- Players can't run the timer or ask for reminders.
select rem_test.sign_in('dan');
select rem_test.refused($$select public.game_reminders_tick()$$, 'players cannot run the reminder timer');
select rem_test.refused($$select * from public.game_reminder_targets(rem_test.id('g1'), 'rsvp')$$, 'or ask for reminders');
select rem_test.refused($$select * from public.game_headcount(rem_test.id('g1'))$$, 'or read the headcount this way');
reset role;

rollback;
