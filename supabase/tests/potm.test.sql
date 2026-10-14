-- Player of the Match voting window database tests: posting a result opens
-- voting until a deadline and tells the team; players who played and haven't
-- voted get a reminder before it closes; votes lock at the deadline; the
-- winners are posted in Team Chat. Run by scripts/test-db.sh after every
-- migration is applied. Everything happens in one transaction that's rolled
-- back, so the other test files never see it. now() is fixed for the whole
-- transaction, so the passing of time is acted out by moving the deadline.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

reset role;
select set_config('request.jwt.claim.sub', '', false);

create schema potm_test;
grant usage on schema potm_test to authenticated, anon;

create table potm_test.people (name text primary key, id uuid not null);
grant select on potm_test.people to authenticated, anon;

create function potm_test.id(who text) returns uuid language sql stable as $$
  select id from potm_test.people where name = who;
$$;

create function potm_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function potm_test.refused(statement text, what text) returns void language plpgsql as $$
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

-- Runs a statement and checks how many rows it touched (RLS hides rows rather than erroring).
create function potm_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
declare
  n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  if n <> expected then
    raise exception 'FAILED: % (touched % rows, expected %)', what, n, expected;
  end if;
  raise notice 'ok - %', what;
end;
$$;

grant execute on all functions in schema potm_test to authenticated, anon;

create function potm_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', potm_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- Requests the database asked notify-chat to make for this game, as "kind" values.
create function potm_test.sent(game uuid) returns text[] language sql as $$
  select coalesce(array_agg(body ->> 'kind' order by id), '{}') from net.test_requests where body ->> 'potm_game_id' = game::text;
$$;

-- Whose phones a notification went to (our test phones only), as names.
create function potm_test.names(subscription_ids uuid[]) returns text[] language sql as $$
  select coalesce(array_agg(p.name order by p.name), '{}')
  from public.push_subscriptions s
  join potm_test.people p on p.id = s.user_id
  where s.id = any (subscription_ids);
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain. Pat, Lee and Ann play; Zed signed up but isn't on the team.
-- Mike is on the roster but hasn't joined the site. Everyone with an account
-- turned notifications on.
-- ---------------------------------------------------------------------------

insert into potm_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000c1'),
  ('pat', '00000000-0000-4000-8000-0000000000c2'),
  ('lee', '00000000-0000-4000-8000-0000000000c3'),
  ('ann', '00000000-0000-4000-8000-0000000000c4'),
  ('zed', '00000000-0000-4000-8000-0000000000c5'),
  ('mike', '00000000-0000-4000-8000-0000000000c6'),
  ('g1', '00000000-0000-4000-8000-0000000000d1'),
  ('old', '00000000-0000-4000-8000-0000000000d2');

insert into auth.users (id, email) select id, name || '@potm.test' from potm_test.people where name in ('kim', 'pat', 'lee', 'ann', 'zed');
update public.users set role = case when id = potm_test.id('kim') then 'admin' else 'user' end,
    joined_team_at = case when id = potm_test.id('zed') then null else now() end
  where id in (select id from potm_test.people);
insert into public.player_profiles (user_id, display_name, gender, status) values
  (potm_test.id('kim'), 'Kim', 'F', 'active'),
  (potm_test.id('pat'), 'Pat', 'M', 'active'),
  (potm_test.id('lee'), 'Lee', 'M', 'active'),
  (potm_test.id('ann'), 'Ann', 'F', 'active');
insert into public.team_guests (id, display_name, gender, status) values (potm_test.id('mike'), 'Mike', 'M', 'active');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test/potm-' || name, 'k', 'a' from potm_test.people where name in ('kim', 'pat', 'lee', 'ann', 'zed');
insert into public.games (id, season_year, session, date, opponent, has_result, score_us, score_them) values
  (potm_test.id('g1'), 2026, 1, current_date, 'Ball Busters', false, null, null),
  -- Its result was posted before voting had a deadline.
  (potm_test.id('old'), 2026, 1, current_date - 30, 'Net Ninjas', true, 1, 1);
delete from public.team_settings;

-- ---------------------------------------------------------------------------
-- Kim posts the result: voting opens for 12 hours and the team is told.
-- ---------------------------------------------------------------------------

select potm_test.sign_in('kim');
update public.games set score_us = 5, score_them = 3, has_result = true where id = potm_test.id('g1');
insert into public.game_stats (game_id, user_id, played) values
  (potm_test.id('g1'), potm_test.id('kim'), true),
  (potm_test.id('g1'), potm_test.id('pat'), true),
  (potm_test.id('g1'), potm_test.id('lee'), true),
  (potm_test.id('g1'), potm_test.id('ann'), true);
insert into public.game_stats (game_id, guest_id, played) values (potm_test.id('g1'), potm_test.id('mike'), true);
reset role;

select potm_test.ok(
  (select potm_opened_at = now() and potm_closes_at = now() + interval '12 hours' from public.games where id = potm_test.id('g1')),
  'posting a result opens voting for 12 hours');
select potm_test.ok(potm_test.sent(potm_test.id('g1')) = '{open}', 'and asks for the team to be told, once');
create temp table open_sent as select * from public.potm_push_targets(potm_test.id('g1'), 'open');
select potm_test.ok(potm_test.names(array(select subscription_id from open_sent)) = '{ann,kim,lee,pat}',
  'everyone on the team is told (not Zed, who isn''t)');
select potm_test.ok(
  (select bool_and(
      title = '🏆 Player of the Match'
      and body ~ '^Final: 5–3 W vs Ball Busters\. Voting is open until [A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M\.$'
      and url = '/games/' || potm_test.id('g1'))
   from open_sent),
  'with the score and when voting closes; tapping it opens the game');
select potm_test.ok((select count(*) = 0 from public.potm_push_targets(potm_test.id('g1'), 'open')), 'a second ask sends nothing');
select potm_test.ok(
  (select potm_when(potm_closes_at) ~ '^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M$' from public.games where id = potm_test.id('g1')),
  'the deadline reads like "Fri 9:30 AM"');
select potm_test.ok(
  (select potm_opened_at is null and potm_closes_at is null from public.games where id = potm_test.id('old')),
  'a result posted before this change has no deadline');

select potm_test.sign_in('kim');
update public.games set score_us = 6 where id = potm_test.id('g1');
reset role;
select potm_test.ok(potm_test.sent(potm_test.id('g1')) = '{open}', 'correcting the score doesn''t open voting again');

-- ---------------------------------------------------------------------------
-- Votes while it's open.
-- ---------------------------------------------------------------------------

select potm_test.sign_in('pat');
insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values
  (potm_test.id('g1'), auth.uid(), potm_test.id('kim'), 'woman'),
  (potm_test.id('g1'), auth.uid(), potm_test.id('lee'), 'man');
reset role;
select potm_test.sign_in('lee');
insert into public.potm_votes (game_id, voter_id, voted_for_guest_id, award) values (potm_test.id('g1'), auth.uid(), potm_test.id('mike'), 'man');
reset role;
select potm_test.sign_in('kim');
insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values (potm_test.id('g1'), auth.uid(), potm_test.id('pat'), 'man');
reset role;
select potm_test.ok((select count(*) = 4 from public.potm_votes where game_id = potm_test.id('g1')), 'players vote while voting is open');

-- ---------------------------------------------------------------------------
-- The reminder: 3 hours before it closes, to players who played and haven't
-- cast both votes (Lee and Kim cast one; Ann none; Pat both).
-- ---------------------------------------------------------------------------

select public.potm_tick();
select potm_test.ok(potm_test.sent(potm_test.id('g1')) = '{open}', 'no reminder with 12 hours to go');

update public.games set potm_opened_at = now() - interval '10 hours', potm_closes_at = now() + interval '2 hours 55 minutes'
  where id = potm_test.id('g1');
select public.potm_tick();
select potm_test.ok(potm_test.sent(potm_test.id('g1')) = '{open,reminder}', '3 hours before it closes, a reminder is asked for');
create temp table reminder_sent as select * from public.potm_push_targets(potm_test.id('g1'), 'reminder');
select public.potm_tick();
select potm_test.ok(potm_test.sent(potm_test.id('g1')) = '{open,reminder}', 'once it''s gone out, the timer doesn''t ask again');
select potm_test.ok(potm_test.names(array(select subscription_id from reminder_sent)) = '{ann,kim,lee}',
  'it goes to players who played and haven''t cast every vote');
select potm_test.ok(
  (select bool_and(
      title = '🏆 Voting closes in 3 hours'
      and body ~ '^You haven''t voted for Player of the Match \(6–3 W vs Ball Busters\)\. Voting closes [A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M\.$')
   from reminder_sent),
  'saying voting closes in 3 hours, and when');
select potm_test.ok((select count(*) = 0 from public.potm_push_targets(potm_test.id('g1'), 'reminder')), 'and it goes out once');

-- ---------------------------------------------------------------------------
-- Voting closes: votes lock, and the winners are posted in Team Chat.
-- ---------------------------------------------------------------------------

update public.games set potm_closes_at = now() - interval '1 minute' where id = potm_test.id('g1');
select potm_test.sign_in('ann');
select potm_test.refused(
  $$insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values (potm_test.id('g1'), auth.uid(), potm_test.id('pat'), 'man')$$,
  'nobody can vote once voting has closed');
select potm_test.touches(
  $$update public.potm_votes set voted_for_id = potm_test.id('ann') where game_id = potm_test.id('g1')$$, 0,
  'or change a vote');
reset role;
select potm_test.sign_in('pat');
select potm_test.touches($$delete from public.potm_votes where voter_id = auth.uid()$$, 0, 'or take one back');
reset role;
delete from public.potm_push_log where game_id = potm_test.id('g1') and kind = 'reminder';
select potm_test.ok((select count(*) = 0 from public.potm_push_targets(potm_test.id('g1'), 'reminder')), 'no reminders after it closes');

select potm_test.sign_in('ann');
insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values (potm_test.id('old'), auth.uid(), potm_test.id('pat'), 'man');
reset role;
select potm_test.ok(exists (select 1 from public.potm_votes where game_id = potm_test.id('old')), 'a game with no deadline still takes votes');

delete from net.test_requests;
select public.potm_tick();
select public.potm_tick();
select potm_test.ok(
  (select count(*) = 1 from public.messages where user_id is null and author_name = 'Scoreboard'),
  'when voting closes, the winners are posted in Team Chat, once');
select potm_test.ok(
  (select body = E'🏆 Player of the Match, 6–3 W vs Ball Busters\nMan of the Match: Lee & Mike & Pat (1 vote each, tied)\nWoman of the Match: Kim (1 vote)'
   from public.messages where author_name = 'Scoreboard'),
  'naming each award''s winner, ties and roster names included');
select potm_test.ok(
  (select count(*) = 1 from net.test_requests where body ? 'message_id'),
  'and it notifies like any Team Chat message');

-- ---------------------------------------------------------------------------
-- Team Settings: a shorter window, no "voting is open" notification, no
-- reminder, no announcement.
-- ---------------------------------------------------------------------------

insert into public.team_settings (potm_mode, potm_window_hours, potm_notify, potm_reminder_hours, potm_announce)
  values ('overall', 6, false, 0, false);
insert into public.games (id, season_year, session, date, opponent) values
  ('00000000-0000-4000-8000-0000000000d3', 2026, 1, current_date, 'Goal Diggers');
delete from net.test_requests;
update public.games set has_result = true, score_us = 1, score_them = 2 where id = '00000000-0000-4000-8000-0000000000d3';
select potm_test.ok(
  (select potm_closes_at = now() + interval '6 hours' from public.games where id = '00000000-0000-4000-8000-0000000000d3'),
  'captains set how long voting stays open');
select potm_test.ok((select count(*) = 0 from net.test_requests), 'and can turn off the "voting is open" notification');
update public.games set potm_opened_at = now() - interval '5 hours 59 minutes', potm_closes_at = now() + interval '1 minute'
  where id = '00000000-0000-4000-8000-0000000000d3';
select public.potm_tick();
select potm_test.ok((select count(*) = 0 from net.test_requests), 'and the reminder');
insert into public.game_stats (game_id, user_id, played) values ('00000000-0000-4000-8000-0000000000d3', potm_test.id('pat'), true);
insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values ('00000000-0000-4000-8000-0000000000d3', potm_test.id('kim'), potm_test.id('pat'), 'overall');
update public.games set potm_closes_at = now() - interval '1 minute' where id = '00000000-0000-4000-8000-0000000000d3';
select public.potm_tick();
select potm_test.ok((select count(*) = 1 from public.messages where author_name = 'Scoreboard'), 'and the announcement');

update public.team_settings set potm_reminder_hours = 1;
select potm_test.ok(
  (select count(*) = 0 from public.potm_push_targets('00000000-0000-4000-8000-0000000000d3', 'open')),
  'nothing is sent for a game whose voting has closed');

-- Players can't change the settings or send notifications themselves.
select potm_test.sign_in('pat');
select potm_test.touches($$update public.team_settings set potm_window_hours = 100$$, 0, 'players cannot change the voting settings');
select potm_test.refused($$select public.potm_tick()$$, 'players cannot run the timer');
select potm_test.refused($$select * from public.potm_push_targets(potm_test.id('g1'), 'open')$$, 'or ask for notifications');
select potm_test.refused($$select count(*) from public.potm_push_log$$, 'or see which went out');
reset role;

rollback;
