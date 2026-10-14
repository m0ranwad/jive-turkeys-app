-- Game database tests for roster names (players who haven't joined the site):
-- captains set their RSVPs and stat lines, teammates can vote for them, and
-- when they join and pick their name it all moves to their account. Run by
-- scripts/test-db.sh after every migration is applied. Everything happens in
-- one transaction that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

-- chat.test.sql runs first and leaves its last sign-in behind: start signed out.
reset role;
select set_config('request.jwt.claim.sub', '', false);

create schema games_test;
grant usage on schema games_test to authenticated, anon;

create table games_test.people (name text primary key, id uuid not null);
grant select on games_test.people to authenticated, anon;

create function games_test.id(who text) returns uuid language sql stable as $$
  select id from games_test.people where name = who;
$$;

create function games_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function games_test.refused(statement text, what text) returns void language plpgsql as $$
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
create function games_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema games_test to authenticated, anon;

create function games_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', games_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain and Pat plays. Mike and Dana are on the roster but haven't
-- joined the site. Game 1 was last week; game 2 is on Thursday.
-- ---------------------------------------------------------------------------

insert into games_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000a1'),
  ('pat', '00000000-0000-4000-8000-0000000000a2'),
  ('mo', '00000000-0000-4000-8000-0000000000a3'),
  ('mike', '00000000-0000-4000-8000-0000000000a6'),
  ('dana', '00000000-0000-4000-8000-0000000000a7'),
  ('g1', '00000000-0000-4000-8000-0000000000b1'),
  ('g2', '00000000-0000-4000-8000-0000000000b2');

insert into auth.users (id, email) select id, name || '@games.test' from games_test.people where name in ('kim', 'pat');
update public.users set role = case when id = games_test.id('kim') then 'admin' else 'user' end, joined_team_at = now()
  where id in (select id from games_test.people);
insert into public.player_profiles (user_id, display_name, gender, status) values
  (games_test.id('kim'), 'Kim', 'F', 'active'),
  (games_test.id('pat'), 'Pat', 'M', 'active');
insert into public.team_guests (id, display_name, gender, status) values
  (games_test.id('mike'), 'Mike', 'M', 'active'),
  (games_test.id('dana'), 'Dana', 'F', 'active');
insert into public.games (id, season_year, session, date, opponent, has_result, score_us, score_them) values
  (games_test.id('g1'), 2026, 1, current_date - 7, 'Net Ninjas', true, 3, 2),
  (games_test.id('g2'), 2026, 1, current_date + 3, 'Goal Diggers', false, null, null);

-- ---------------------------------------------------------------------------
-- Captains set RSVPs and stat lines, for roster names and app players.
-- ---------------------------------------------------------------------------

select games_test.sign_in('kim');
select games_test.touches(
  $$insert into public.rsvps (game_id, guest_id, status) values (games_test.id('g2'), games_test.id('mike'), 'in')$$, 1,
  'a captain RSVPs for a roster name');
select games_test.touches(
  $$insert into public.rsvps (game_id, user_id, status) values (games_test.id('g2'), games_test.id('pat'), 'out')$$, 1,
  'and for a player who told them another way');
select games_test.touches(
  $$insert into public.game_stats (game_id, guest_id, played, goals) values (games_test.id('g1'), games_test.id('mike'), true, 1)$$, 1,
  'a captain records a roster name''s stat line');
select games_test.refused(
  $$insert into public.rsvps (game_id, guest_id, status) values (games_test.id('g2'), games_test.id('mike'), 'maybe')$$,
  'a roster name has one RSVP per game');
select games_test.refused(
  $$insert into public.rsvps (game_id, user_id, guest_id, status) values (games_test.id('g1'), games_test.id('pat'), games_test.id('dana'), 'in')$$,
  'an RSVP belongs to one player');
select games_test.refused(
  $$insert into public.rsvps (game_id, status) values (games_test.id('g1'), 'in')$$,
  'an RSVP belongs to someone');
select games_test.refused(
  $$insert into public.game_stats (game_id, played) values (games_test.id('g1'), true)$$,
  'a stat line belongs to someone');
reset role;

-- ---------------------------------------------------------------------------
-- Players answer for themselves only, and can vote for a roster name.
-- ---------------------------------------------------------------------------

select games_test.sign_in('pat');
select games_test.touches($$update public.rsvps set status = 'in' where user_id = auth.uid()$$, 1,
  'a player changes an RSVP a captain set for them');
select games_test.touches($$update public.rsvps set status = 'out' where guest_id = games_test.id('mike')$$, 0,
  'players cannot change a roster name''s RSVP');
select games_test.refused(
  $$insert into public.rsvps (game_id, guest_id, status) values (games_test.id('g2'), games_test.id('dana'), 'in')$$,
  'players cannot RSVP for a roster name');
select games_test.refused(
  $$insert into public.game_stats (game_id, guest_id, played) values (games_test.id('g1'), games_test.id('dana'), true)$$,
  'players cannot enter stat lines');
select games_test.touches(
  $$insert into public.potm_votes (game_id, voter_id, voted_for_guest_id, award)
    values (games_test.id('g1'), auth.uid(), games_test.id('mike'), 'man')$$, 1,
  'a player votes for a roster name for Player of the Match');
select games_test.touches(
  $$update public.potm_votes set voted_for_id = games_test.id('kim'), voted_for_guest_id = null where voter_id = auth.uid()$$, 1,
  'and can change the vote to an app player');
select games_test.touches(
  $$update public.potm_votes set voted_for_id = null, voted_for_guest_id = games_test.id('mike') where voter_id = auth.uid()$$, 1,
  'and back');
select games_test.refused(
  $$insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values (games_test.id('g1'), auth.uid(), auth.uid(), 'overall')$$,
  'nobody votes for themselves');
select games_test.refused(
  $$insert into public.potm_votes (game_id, voter_id, award) values (games_test.id('g1'), auth.uid(), 'overall')$$,
  'a vote is for someone');
reset role;

-- ---------------------------------------------------------------------------
-- Fill-ins from outside the team: captains record them on a game's result,
-- teammates see them, and nobody else changes them.
-- ---------------------------------------------------------------------------

select games_test.sign_in('kim');
select games_test.touches(
  $$insert into public.game_fill_ins (game_id, gender, goals) values (games_test.id('g1'), 'M', 1)$$, 1,
  'a captain records a fill-in nobody caught the name of');
select games_test.touches(
  $$insert into public.game_fill_ins (game_id, display_name, gender, assists) values (games_test.id('g1'), 'Dave', 'M', 1)$$, 1,
  'and one with a name');
select games_test.touches($$update public.game_fill_ins set goals = 2 where display_name = 'Dave'$$, 1,
  'a captain changes a fill-in''s goals');
select games_test.refused(
  $$insert into public.game_fill_ins (game_id, gender, goals) values (games_test.id('g1'), 'M', -1)$$,
  'goals can''t go below zero');
select games_test.refused(
  $$insert into public.game_fill_ins (game_id, display_name) values (games_test.id('g1'), '   ')$$,
  'a fill-in''s name is a name or left blank');
select games_test.refused(
  $$insert into public.game_fill_ins (gender, goals) values ('F', 1)$$,
  'a fill-in belongs to a game');
reset role;

select games_test.sign_in('pat');
select games_test.ok((select count(*) = 2 from public.game_fill_ins), 'teammates see the fill-ins');
select games_test.refused(
  $$insert into public.game_fill_ins (game_id, gender, goals) values (games_test.id('g1'), 'F', 1)$$,
  'players cannot add fill-ins');
select games_test.touches($$update public.game_fill_ins set goals = 5$$, 0, 'or change them');
select games_test.touches($$delete from public.game_fill_ins$$, 0, 'or remove them');
reset role;

-- ---------------------------------------------------------------------------
-- Mo joins: he already said OUT for Thursday himself, then picks Mike's name.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values (games_test.id('mo'), 'mo@games.test');
update public.users set joined_team_at = now() where id = games_test.id('mo');
select games_test.sign_in('mo');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Mo', 'M', 'active');
insert into public.rsvps (game_id, user_id, status) values (games_test.id('g2'), auth.uid(), 'out');
select public.claim_team_guest(games_test.id('mike'));
reset role;

select games_test.ok(
  (select status = 'out' from public.rsvps where game_id = games_test.id('g2') and user_id = games_test.id('mo')),
  'picking your name keeps your own RSVP where you had one');
select games_test.ok(
  exists (select 1 from public.rsvps where game_id = games_test.id('g2') and guest_id = games_test.id('mike')),
  'and the roster name''s is kept, not deleted');
select games_test.ok(
  (select goals = 1 and guest_id is null from public.game_stats where game_id = games_test.id('g1') and user_id = games_test.id('mo')),
  'the roster name''s stat lines move to your account');
select games_test.ok(
  (select voted_for_id = games_test.id('mo') and voted_for_guest_id is null from public.potm_votes where voter_id = games_test.id('pat')),
  'and so do votes for it');

-- ---------------------------------------------------------------------------
-- A result saves in one step: the score, stat lines and fill-ins together, or
-- nothing at all.
-- ---------------------------------------------------------------------------

select games_test.sign_in('pat');
select games_test.refused(
  $$select public.save_game_result(games_test.id('g2'), 9, 0, '[]'::jsonb, '[]'::jsonb)$$,
  'players cannot save a result');
reset role;

select games_test.sign_in('kim');
select public.save_game_result(
  games_test.id('g2'), 3, 1,
  jsonb_build_array(
    jsonb_build_object('user_id', games_test.id('kim'), 'played', true, 'goals', 1),
    jsonb_build_object('user_id', games_test.id('pat'), 'played', true, 'assists', 1),
    jsonb_build_object('guest_id', games_test.id('dana'), 'played', true, 'goals', 1)
  ),
  jsonb_build_array(jsonb_build_object('display_name', ' Sub Steve ', 'gender', 'M', 'goals', 1))
);
reset role;
select games_test.ok(
  (select has_result and score_us = 3 and score_them = 1 from public.games where id = games_test.id('g2')),
  'a captain saves the score');
select games_test.ok(
  (select count(*) = 3 from public.game_stats where game_id = games_test.id('g2') and played),
  'with each player''s stat line, roster names included');
select games_test.ok(
  (select display_name = 'Sub Steve' from public.game_fill_ins where game_id = games_test.id('g2')),
  'and the fill-ins');

-- Pat didn't play after all, and the fill-in's goal was Kim's.
select games_test.sign_in('kim');
select public.save_game_result(
  games_test.id('g2'), 3, 1,
  jsonb_build_array(
    jsonb_build_object('user_id', games_test.id('kim'), 'played', true, 'goals', 2),
    jsonb_build_object('user_id', games_test.id('pat'), 'played', false)
  ),
  '[]'::jsonb
);
reset role;
select games_test.ok(
  (select goals = 2 from public.game_stats where game_id = games_test.id('g2') and user_id = games_test.id('kim')),
  'editing a result changes the lines');
select games_test.ok(
  not exists (select 1 from public.game_stats where game_id = games_test.id('g2') and user_id = games_test.id('pat')),
  'removes a line for someone who didn''t play');
select games_test.ok(
  exists (select 1 from public.game_stats where game_id = games_test.id('g2') and guest_id = games_test.id('dana')),
  'keeps lines for players not on the screen');
select games_test.ok(not exists (select 1 from public.game_fill_ins where game_id = games_test.id('g2')), 'and removes fill-ins taken off');

select games_test.sign_in('kim');
select games_test.refused(
  $$select public.save_game_result(games_test.id('g2'), 7, 7,
      jsonb_build_array(jsonb_build_object('user_id', games_test.id('kim'), 'played', true, 'goals', 0)),
      jsonb_build_array(jsonb_build_object('gender', 'M', 'goals', -1)))$$,
  'a save that fails partway');
reset role;
select games_test.ok(
  (select score_us = 3 and score_them = 1 from public.games where id = games_test.id('g2'))
  and (select goals = 2 from public.game_stats where game_id = games_test.id('g2') and user_id = games_test.id('kim')),
  'changes nothing at all');

-- Deleting a game takes its fill-ins with it.
delete from public.games where id = games_test.id('g1');
select games_test.ok(not exists (select 1 from public.game_fill_ins), 'a deleted game''s fill-ins go with it');

rollback;
