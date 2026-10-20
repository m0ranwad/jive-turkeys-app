-- "Playing session N?" notifications (Game alerts): when captains ask about a
-- session ahead, everyone on its list hears about it; at noon a week before the
-- session starts, anyone who hasn't answered gets a reminder, whether captains
-- asked ahead or the question opened on its own. Run by scripts/test-db.sh;
-- everything is rolled back. now() is fixed for the whole transaction, so the
-- clock is acted out with the functions' p_at. The first failed check stops
-- the run with "FAILED: ...".

begin;

reset role;
select set_config('request.jwt.claim.sub', '', false);

create schema sn_test;
grant usage on schema sn_test to authenticated, anon;
create table sn_test.people (name text primary key, id uuid not null);
grant select on sn_test.people to authenticated, anon;

create function sn_test.id(who text) returns uuid language sql stable as $$
  select id from sn_test.people where name = who;
$$;

create function sn_test.today() returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date;
$$;

-- A moment in Eastern time: `days` from today at `hhmm`.
create function sn_test.at(days integer, hhmm text) returns timestamptz language sql stable as $$
  select ((sn_test.today() + days) + hhmm::time) at time zone 'America/New_York';
$$;

create function sn_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function sn_test.refused(statement text, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema sn_test to authenticated, anon;

create function sn_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', sn_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- Whose phones a set of subscriptions belongs to, as names.
create function sn_test.names(subscription_ids uuid[]) returns text[] language sql as $$
  select coalesce(array_agg(p.name order by p.name), '{}')
  from public.push_subscriptions s join sn_test.people p on p.id = s.user_id
  where s.id = any (subscription_ids);
$$;

-- What the database asked notify-chat to send about a session, as kinds.
create function sn_test.sent(s integer) returns text[] language sql as $$
  select coalesce(array_agg(body ->> 'kind' order by id), '{}') from net.test_requests
  where body -> 'session_ask' = jsonb_build_object('year', 2031, 'session', s);
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain; Pat is Active, Lee is in the sub pool and Rex is on break
-- (he turned Game alerts off). Ada was taken off the team. Neo signed up but
-- hasn't entered the team code. Gus is a roster name who hasn't joined. Everyone
-- with an account turned notifications on. Session 1 is under way: a game three
-- weeks ago and one in three days. Session 2's schedule isn't out.
-- ---------------------------------------------------------------------------

delete from public.session_roster;
delete from net.test_requests;
insert into sn_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000d1'), ('pat', '00000000-0000-4000-8000-0000000000d2'),
  ('lee', '00000000-0000-4000-8000-0000000000d3'), ('rex', '00000000-0000-4000-8000-0000000000d4'),
  ('ada', '00000000-0000-4000-8000-0000000000d5'), ('neo', '00000000-0000-4000-8000-0000000000d6'),
  ('gus', '00000000-0000-4000-8000-0000000000d7');
insert into auth.users (id, email) select id, name || '@sn.test' from sn_test.people where name <> 'gus';
update public.users set role = case when id = sn_test.id('kim') then 'admin' else 'user' end
  where id in (select id from sn_test.people);
update public.users set joined_team_at = now() where id in (select id from sn_test.people) and id <> sn_test.id('neo');
insert into public.player_profiles (user_id, display_name, gender, status, notify_games, removed) values
  (sn_test.id('kim'), 'Kim', 'F', 'active', true, false),
  (sn_test.id('pat'), 'Pat', 'M', 'active', true, false),
  (sn_test.id('lee'), 'Lee', 'F', 'sub_pool', true, false),
  (sn_test.id('rex'), 'Rex', 'M', 'on_break', false, false),
  (sn_test.id('ada'), 'Ada', 'F', 'active', true, true),
  (sn_test.id('neo'), 'Neo', 'M', 'active', true, false);
insert into public.team_guests (id, display_name, gender, status) values (sn_test.id('gus'), 'Gus', 'M', 'active');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test/sn-' || name, 'k', 'a' from sn_test.people where name <> 'gus';
insert into public.games (season_year, session, date, opponent) values
  (2031, 1, sn_test.today() - 20, 'Net Ninjas'),
  (2031, 1, sn_test.today() + 3, 'Goal Diggers');

-- ---------------------------------------------------------------------------
-- Captains ask about session 2, starting in 30 days: everyone on its list hears.
-- ---------------------------------------------------------------------------

select sn_test.sign_in('kim');
select public.roster_ask(2031, 2, sn_test.today() + 30);
reset role;
select sn_test.ok(sn_test.sent(2) = '{asked}', 'captains asking sends "Playing session 2?" right away');

create temp table asked_sent as select * from public.session_ask_targets(2031, 2, 'asked');
select sn_test.ok(sn_test.names(array(select subscription_id from asked_sent)) = '{lee,pat}',
  'to everyone asked: Active and sub pool (not the captain who asked, not with Game alerts off, not taken off the team, not before the team code)');
select sn_test.ok(
  (select bool_and(title = '📋 Playing session 2?'
     and body = 'Session 2 starts ' || to_char(sn_test.today() + 30, 'Dy, Mon FMDD') || '. Tap to say I''m in, Sub only or Sitting out.'
     and url = '/') from asked_sent),
  'it says when the session starts and opens Schedule');
select sn_test.ok((select count(*) = 0 from public.session_ask_targets(2031, 2, 'asked')), 'it goes out once');

select sn_test.sign_in('kim');
select public.roster_ask(2031, 2, sn_test.today() + 31);
select public.roster_ask(2031, 2, null);
select public.roster_ask(2031, 2, sn_test.today() + 30);
reset role;
select sn_test.ok(sn_test.sent(2) = '{asked}', 'changing the date, or stopping and asking again, doesn''t send it again');

-- ---------------------------------------------------------------------------
-- The reminder: noon a week before the start, between noon and 9 PM, not on
-- the first game's day, and at least a day after the "captains asked" one.
-- ---------------------------------------------------------------------------

select sn_test.ok(not public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(22, '13:00')), '8 days before: too early');
select sn_test.ok(not public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(23, '11:59')), 'a week before, before noon: not yet');
select sn_test.ok(public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(23, '12:00')), 'a week before at noon: due');
select sn_test.ok(public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(27, '20:59'))
  and not public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(27, '21:00'))
  and not public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(28, '09:00')),
  'if it''s late, only between noon and 9 PM');
select sn_test.ok(not public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(30, '13:00')), 'never on the first game''s day');
update public.session_ask_log set created_date = sn_test.at(23, '10:00') where season_year = 2031 and session = 2 and kind = 'asked';
select sn_test.ok(not public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(23, '12:00'))
  and public.session_reminder_due(2031, 2, sn_test.today() + 30, sn_test.at(24, '12:00')),
  'captains asked that morning: it waits a day');
update public.session_ask_log set created_date = now() where season_year = 2031 and session = 2 and kind = 'asked';

-- Pat answers; Kim (who asked) and Lee haven't.
select sn_test.sign_in('pat');
select public.roster_answer(2031, 2, 'active');
reset role;

select public.session_asks_tick(sn_test.at(22, '13:00'));
select sn_test.ok(sn_test.sent(2) = '{asked}', 'the timer waits until a week before');
select public.session_asks_tick(sn_test.at(23, '12:05'));
select sn_test.ok(sn_test.sent(2) = '{asked,reminder}', 'then asks for the reminder');

create temp table reminder_sent as select * from public.session_ask_targets(2031, 2, 'reminder', sn_test.at(23, '12:05'));
select sn_test.ok(sn_test.names(array(select subscription_id from reminder_sent)) = '{kim,lee}',
  'the reminder goes to everyone asked who hasn''t answered, the captain who asked too');
select sn_test.ok(
  (select bool_and(title = '📋 Playing session 2?'
     and body = 'Session 2 starts ' || to_char(sn_test.today() + 30, 'Dy, Mon FMDD')
       || ' and you haven''t answered yet. Tap to say I''m in, Sub only or Sitting out.'
     and url = '/') from reminder_sent),
  'it says they haven''t answered yet');
select sn_test.ok((select count(*) = 0 from public.session_ask_targets(2031, 2, 'reminder', sn_test.at(23, '12:10'))), 'it goes out once');
select public.session_asks_tick(sn_test.at(23, '12:10'));
select sn_test.ok(sn_test.sent(2) = '{asked,reminder}', 'and the timer doesn''t ask again');

-- ---------------------------------------------------------------------------
-- Nobody asked ahead: session 3's question opens on its own once session 2 is
-- over and session 3's first game is next. Its schedule went up late (the game
-- is in 5 days), so the reminder goes out at the next noon.
-- ---------------------------------------------------------------------------

update public.games set date = sn_test.today() - 2 where season_year = 2031 and session = 1 and date > sn_test.today();
select sn_test.sign_in('kim');
select public.roster_ask(2031, 2, null);
reset role;
insert into public.games (season_year, session, date, opponent) values
  (2031, 3, sn_test.today() + 5, 'Ball Busters'),
  (2031, 3, sn_test.today() + 12, 'FC Lightning');
select sn_test.ok((select count(*) = 0 from public.session_ask_targets(2031, 3, 'asked')), 'no "captains asked" notification when they didn''t');
select public.session_asks_tick(sn_test.at(1, '08:00'));
select sn_test.ok(sn_test.sent(3) = '{}', 'opened late at night or in the morning: the reminder waits for noon');
select public.session_asks_tick(sn_test.at(1, '12:00'));
select sn_test.ok(sn_test.sent(3) = '{reminder}', 'then goes out');
create temp table own_sent as select * from public.session_ask_targets(2031, 3, 'reminder', sn_test.at(1, '12:00'));
select sn_test.ok(sn_test.names(array(select subscription_id from own_sent)) = '{kim,lee,pat}',
  'to everyone who hasn''t answered (the session''s list starts if nobody opened the site)');
select sn_test.ok((select bool_and(body like 'Session 3 starts % and you haven''t answered yet.%') from own_sent), 'about session 3');

-- Once its first game is played, nothing more.
delete from public.session_ask_log where season_year = 2031 and session = 3;
update public.games set date = sn_test.today() - 1 where season_year = 2031 and session = 3 and opponent = 'Ball Busters';
select sn_test.ok((select count(*) = 0 from public.session_ask_targets(2031, 3, 'reminder', sn_test.at(0, '13:00'))),
  'nothing once the session''s first game is played');

-- Players can't run the timer or ask who to notify.
select sn_test.sign_in('pat');
select sn_test.refused($$select public.session_asks_tick()$$, 'players cannot run the timer');
select sn_test.refused($$select * from public.session_ask_targets(2031, 2, 'asked')$$, 'or ask who to notify');
select sn_test.refused($$select * from public.session_questions()$$, 'or read the open questions this way');
select sn_test.refused($$select * from public.session_ask_log$$, 'or read what went out');
reset role;

rollback;
