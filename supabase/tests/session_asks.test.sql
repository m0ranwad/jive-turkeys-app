-- "Playing session 2?" asked ahead: captains ask about a later session before
-- its schedule is out, players answer for that session only, and when it
-- becomes the current one its list is brought up to date and the answers
-- become everyone's status. Run by scripts/test-db.sh after every migration is
-- applied, in one transaction that's rolled back. The first failed check stops
-- the run with "FAILED: <what was expected>".

begin;

create schema ask_test;
grant usage on schema ask_test to authenticated, anon;

create table ask_test.people (name text primary key, id uuid not null);
grant select on ask_test.people to authenticated, anon;

create function ask_test.id(who text) returns uuid language sql stable as $$
  select id from ask_test.people where name = who;
$$;

create function ask_test.today() returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date;
$$;

create function ask_test.year() returns integer language sql stable as $$
  select extract(year from ask_test.today())::integer;
$$;

-- Someone's entry in a session of this year's: status, or 'none' if they aren't on it.
create function ask_test.status(who text, s integer) returns text language sql stable as $$
  select coalesce(
    (select r.status from public.session_roster r
     where r.season_year = ask_test.year() and r.session = s and ask_test.id(who) in (r.user_id, r.guest_id)),
    'none');
$$;

create function ask_test.answered(who text, s integer) returns boolean language sql stable as $$
  select coalesce(
    (select r.answered_at is not null from public.session_roster r
     where r.season_year = ask_test.year() and r.session = s and ask_test.id(who) in (r.user_id, r.guest_id)),
    false);
$$;

create function ask_test.profile(who text) returns text language sql stable as $$
  select coalesce(
    (select status from public.player_profiles where user_id = ask_test.id(who)),
    (select status from public.team_guests where id = ask_test.id(who)));
$$;

create function ask_test.changes(s integer) returns bigint language sql stable as $$
  select count(*) from public.dues_changes where season_year = ask_test.year() and session = s and kind = 'roster';
$$;

-- Dues changes recorded for a session since the last mark().
create table ask_test.marks (s integer primary key, n bigint not null);
grant select on ask_test.marks to authenticated, anon;
create function ask_test.mark() returns void language sql as $$
  insert into ask_test.marks values (1, ask_test.changes(1)), (2, ask_test.changes(2))
  on conflict (s) do update set n = excluded.n;
$$;
create function ask_test.since(s integer) returns bigint language sql stable as $$
  select ask_test.changes(s) - (select n from ask_test.marks m where m.s = since.s);
$$;

create function ask_test.current() returns jsonb language sql stable as $$
  select jsonb_build_object('season_year', cur_year, 'session', cur_session) from public.roster_current_session();
$$;

create function ask_test.session(s integer) returns jsonb language sql stable as $$
  select jsonb_build_object('season_year', ask_test.year(), 'session', s);
$$;

create function ask_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function ask_test.refused(statement text, what text) returns void language plpgsql as $$
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

create function ask_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema ask_test to authenticated, anon;

create function ask_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', ask_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain; Pat, Lee, Rex and Ada play; Gus and Sam are on the roster
-- but haven't joined the app (Neo and Zed join later). Session 1 is under way: a game three weeks ago and its last
-- one in three days. Session 2's schedule isn't out.
-- ---------------------------------------------------------------------------

insert into ask_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000f1'),
  ('pat', '00000000-0000-4000-8000-0000000000f2'),
  ('lee', '00000000-0000-4000-8000-0000000000f3'),
  ('rex', '00000000-0000-4000-8000-0000000000f4'),
  ('neo', '00000000-0000-4000-8000-0000000000f5'),
  ('gus', '00000000-0000-4000-8000-0000000000f6'),
  ('ada', '00000000-0000-4000-8000-0000000000f7'),
  ('zed', '00000000-0000-4000-8000-0000000000f8'),
  ('sam', '00000000-0000-4000-8000-0000000000f9');

insert into auth.users (id, email)
  select id, name || '@ask.test' from ask_test.people where name in ('kim', 'pat', 'lee', 'rex', 'neo', 'ada', 'zed');
update public.users set role = case when id = ask_test.id('kim') then 'admin' else 'user' end
  where id in (select id from ask_test.people);
update public.users set joined_team_at = now();

insert into public.games (season_year, session, date, opponent) values
  (ask_test.year(), 1, ask_test.today() - 20, 'Net Ninjas'),
  (ask_test.year(), 1, ask_test.today() + 3, 'Goal Diggers');

insert into public.player_profiles (user_id, display_name, gender, status) values
  (ask_test.id('kim'), 'Kim Captain', 'F', 'active'),
  (ask_test.id('pat'), 'Pat Player', 'M', 'active'),
  (ask_test.id('lee'), 'Lee Player', 'M', 'active'),
  (ask_test.id('rex'), 'Rex Player', 'M', 'active'),
  (ask_test.id('ada'), 'Ada Player', 'F', 'active');
insert into public.team_guests (id, display_name, gender, status) values
  (ask_test.id('gus'), 'Gus Guest', 'M', 'active'),
  (ask_test.id('sam'), 'Sam Guest', 'F', 'active');

select ask_test.ok(ask_test.current() = ask_test.session(1), 'session 1 is the current session while it has games left');

-- Asking is for captains, and only through roster_ask().
select ask_test.sign_in('pat');
select ask_test.refused($$select public.roster_ask(ask_test.year(), 2, ask_test.today() + 30)$$, 'players cannot ask who''s playing');
select ask_test.refused(
  $$insert into public.session_asks (season_year, session, starts_on) values (ask_test.year(), 2, ask_test.today() + 30)$$,
  'players cannot add an ask directly');
select ask_test.refused($$select public.roster_answer(ask_test.year(), 2, 'on_break')$$,
  'nobody can answer for a session nobody asked about');
reset role;

select ask_test.sign_in('kim');
select ask_test.refused($$select public.roster_ask(ask_test.year(), 1, ask_test.today() + 30)$$,
  'captains cannot ask about a session that has started');
select ask_test.refused($$select public.roster_ask(ask_test.year() - 1, 3, ask_test.today() + 30)$$,
  'or one that is over');
select ask_test.refused(
  $$insert into public.session_asks (season_year, session, starts_on) values (ask_test.year(), 2, ask_test.today() + 30)$$,
  'captains ask through roster_ask(), not by adding rows');
select public.roster_ask(ask_test.year(), 2, ask_test.today() + 30);
reset role;

select ask_test.ok(
  (select starts_on = ask_test.today() + 30 and asked_by = ask_test.id('kim') and applied_at is null
   from public.session_asks where season_year = ask_test.year() and session = 2),
  'a captain asks who''s playing session 2, with its first game''s date');
select ask_test.ok(
  ask_test.status('pat', 2) = 'active' and ask_test.status('gus', 2) = 'active' and ask_test.status('kim', 2) = 'active'
    and not exists (select 1 from public.session_roster where session = 2 and answered_at is not null),
  'session 2''s list starts as a copy of everyone''s status, nobody answered');
select ask_test.ok(ask_test.current() = ask_test.session(1), 'session 1 is still the current session: it has a game left');

-- ---------------------------------------------------------------------------
-- Answers for session 2 while session 1 still has a game.
-- ---------------------------------------------------------------------------

select ask_test.mark();
select ask_test.sign_in('pat');
select ask_test.ok((select count(*) = 1 from public.session_asks), 'players see what captains asked');
select ask_test.touches($$update public.session_asks set starts_on = ask_test.today() + 1$$, 0,
  'players cannot change an ask directly');
select public.roster_answer(ask_test.year(), 2, 'on_break');
select ask_test.ok(ask_test.status('pat', 2) = 'on_break' and ask_test.answered('pat', 2),
  'a player sits out session 2: it counts for session 2');
select ask_test.ok(ask_test.status('pat', 1) = 'active' and ask_test.profile('pat') = 'active',
  'session 1 and their status right now stay as they are');
select ask_test.ok(ask_test.since(2) = 1 and ask_test.since(1) = 0,
  'it shows in session 2''s dues changes, not session 1''s');
select public.roster_answer(ask_test.year(), 2, 'active');
select public.roster_answer(ask_test.year(), 2, 'on_break');
select ask_test.ok(ask_test.status('pat', 2) = 'on_break', 'they can change their answer');
select ask_test.refused($$select public.roster_answer(ask_test.year(), 2, 'off')$$, 'answers are I''m in, Sub only or Sitting out');
select ask_test.refused($$select public.roster_answer(ask_test.year(), 3, 'active')$$, 'nobody asked about session 3');
select ask_test.touches($$update public.session_roster set status = 'active' where session = 2 and user_id = auth.uid()$$, 0,
  'players still cannot edit the session lists directly');
reset role;

-- Status changes while session 1 is current still count for session 1.
select ask_test.sign_in('lee');
select ask_test.touches($$update public.player_profiles set status = 'sub_pool' where user_id = auth.uid()$$, 1,
  'a player goes to the sub pool for session 1''s last game');
select ask_test.ok(ask_test.status('lee', 1) = 'sub_pool' and ask_test.answered('lee', 1),
  'that counts for session 1, as their answer');
select ask_test.ok(ask_test.status('lee', 2) = 'sub_pool' and not ask_test.answered('lee', 2),
  'session 2 keeps up with their status, still waiting for their answer');
select public.roster_answer(ask_test.year(), 2, 'active');
select ask_test.touches($$update public.player_profiles set status = 'on_break' where user_id = auth.uid()$$, 1,
  'they answer for session 2, then sit out session 1''s last game');
select ask_test.ok(ask_test.status('lee', 2) = 'active' and ask_test.status('lee', 1) = 'on_break',
  'their answer for session 2 stays');
select ask_test.touches($$update public.player_profiles set status = 'sub_pool' where user_id = auth.uid()$$, 1,
  'back to the sub pool for session 1');
reset role;

-- Someone joins after the ask, and a captain takes Rex off the team.
select ask_test.sign_in('neo');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Neo New', 'M', 'active');
reset role;
select ask_test.ok(ask_test.status('neo', 1) = 'active' and ask_test.status('neo', 2) = 'active'
    and not ask_test.answered('neo', 2),
  'a new player is on session 1, and on session 2 waiting for their answer');
select ask_test.sign_in('rex');
select public.roster_answer(ask_test.year(), 2, 'active');
reset role;
select ask_test.sign_in('kim');
select public.set_team_member_removed(ask_test.id('rex'), true);
reset role;
select ask_test.ok(ask_test.status('rex', 1) = 'off' and ask_test.status('rex', 2) = 'off',
  'a removed player comes off session 1, and session 2 even though they had answered');
-- Pat's three answers and Lee's one.
select ask_test.ok(ask_test.since(2) = 4,
  'session 2''s list keeping up isn''t recorded as anyone changing their status, only answers are');

-- Ada answers, is taken off the team, and is added back: she's on session 2
-- again, following her status and asked again (her answer went with her).
select ask_test.sign_in('ada');
select public.roster_answer(ask_test.year(), 2, 'sub_pool');
reset role;
select ask_test.sign_in('kim');
select public.set_team_member_removed(ask_test.id('ada'), true);
select public.set_team_member_removed(ask_test.id('ada'), false);
reset role;
select ask_test.ok(ask_test.status('ada', 2) = 'active' and not ask_test.answered('ada', 2),
  'a player added back is on session 2 again as Active, still to answer');
select ask_test.ok(ask_test.status('ada', 1) = 'active', 'and on session 1');

-- A captain answers for Sam, a roster name, then a new player picks that name.
select ask_test.sign_in('kim');
select ask_test.touches(
  $$update public.session_roster set status = 'on_break', answered_at = now(), changed_by = auth.uid()
    where season_year = ask_test.year() and session = 2 and guest_id = ask_test.id('sam')$$, 1,
  'a captain answers for a roster name: sitting out session 2');
reset role;
select ask_test.sign_in('zed');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Zed New', 'F', 'active');
select public.claim_team_guest(ask_test.id('sam'));
reset role;
select ask_test.ok(ask_test.status('zed', 2) = 'on_break' and ask_test.answered('zed', 2),
  'the player who picks that name keeps the answer given for it');
select ask_test.ok(ask_test.status('zed', 1) = 'active' and ask_test.profile('zed') = 'active',
  'session 1 and their status right now are the name''s, as before');
select ask_test.sign_in('kim');
select public.unlink_team_guest(ask_test.id('sam'));
reset role;
select ask_test.ok(ask_test.status('sam', 2) = 'on_break' and ask_test.answered('sam', 2),
  'undoing the pick gives the name its answer back');
select ask_test.ok(ask_test.status('zed', 2) = 'active' and not ask_test.answered('zed', 2),
  'and the account is back on session 2, still to answer');
select ask_test.sign_in('zed');
select public.claim_team_guest(ask_test.id('sam'));
reset role;
select ask_test.ok(ask_test.status('zed', 2) = 'on_break' and ask_test.answered('zed', 2),
  'picking the name again brings the answer over again');

-- Captains stop asking, Ada (still to answer) sits out session 1's last game,
-- and captains ask again.
select ask_test.sign_in('kim');
select public.roster_ask(ask_test.year(), 2, null);
reset role;
select ask_test.sign_in('ada');
select ask_test.touches($$update public.player_profiles set status = 'on_break' where user_id = auth.uid()$$, 1,
  'a player still to answer sits out while captains aren''t asking');
reset role;
select ask_test.sign_in('kim');
select public.roster_ask(ask_test.year(), 2, ask_test.today() + 30);
reset role;
select ask_test.ok(ask_test.status('ada', 2) = 'on_break' and not ask_test.answered('ada', 2),
  'asking again brings session 2 up to date for anyone still to answer');
select ask_test.ok(
  ask_test.status('pat', 2) = 'on_break' and ask_test.answered('pat', 2) and ask_test.status('lee', 2) = 'active'
    and ask_test.status('rex', 2) = 'off',
  'and keeps the answers given');

-- ---------------------------------------------------------------------------
-- Session 1's last game is played: session 2 is the current session, before
-- its schedule is out.
-- ---------------------------------------------------------------------------

select ask_test.mark();
update public.games set date = ask_test.today() - 1 where opponent = 'Goal Diggers';
select ask_test.ok(ask_test.current() = ask_test.session(2), 'between sessions, the asked session is the current one');

select ask_test.sign_in('lee');
select ask_test.ok(public.roster_start_current() = ask_test.session(2), 'the site opens on session 2');
reset role;
select ask_test.ok(
  (select applied_at is not null from public.session_asks where season_year = ask_test.year() and session = 2),
  'session 2 is brought up to date once');
select ask_test.ok(ask_test.profile('pat') = 'on_break' and ask_test.status('pat', 2) = 'on_break' and ask_test.answered('pat', 2),
  'an answer given ahead becomes the player''s status right now');
select ask_test.ok(ask_test.profile('lee') = 'active' and ask_test.status('lee', 2) = 'active' and ask_test.answered('lee', 2),
  'including an answer that differs from their status during session 1');
select ask_test.ok(ask_test.status('kim', 2) = 'active' and not ask_test.answered('kim', 2),
  'players who didn''t answer carry over their status, still to answer');
select ask_test.ok(ask_test.status('neo', 2) = 'active' and not ask_test.answered('neo', 2),
  'players who joined since the ask are on session 2');
select ask_test.ok(ask_test.status('rex', 2) = 'off', 'players taken off the team since are off session 2');
select ask_test.ok(ask_test.status('pat', 1) = 'active' and ask_test.status('lee', 1) = 'sub_pool' and ask_test.status('rex', 1) = 'off',
  'session 1 is exactly as it was');
select ask_test.ok(ask_test.since(2) = 0 and ask_test.since(1) = 0,
  'bringing session 2 up to date isn''t recorded as anyone changing their status');

select ask_test.sign_in('kim');
select public.roster_start_current();
reset role;
select ask_test.ok(ask_test.since(2) = 0 and ask_test.profile('pat') = 'on_break', 'opening the site again changes nothing');

-- Status changes between sessions count for session 2 now, not the session that just ended.
select ask_test.sign_in('lee');
select ask_test.touches($$update public.player_profiles set status = 'on_break' where user_id = auth.uid()$$, 1,
  'a player sits out between sessions');
select ask_test.ok(ask_test.status('lee', 2) = 'on_break' and ask_test.answered('lee', 2) and ask_test.status('lee', 1) = 'sub_pool',
  'it counts for session 2, and session 1 keeps what they had');
reset role;
select ask_test.sign_in('kim');
select ask_test.touches($$update public.team_guests set status = 'sub_pool' where id = ask_test.id('gus')$$, 1,
  'a captain answers for a roster name between sessions');
select ask_test.ok(ask_test.status('gus', 2) = 'sub_pool' and ask_test.answered('gus', 2) and ask_test.status('gus', 1) = 'active',
  'it counts for session 2 too');
reset role;

-- Answering the current session is your status, as it always was.
select ask_test.sign_in('neo');
select public.roster_answer(ask_test.year(), 2, 'sub_pool');
select ask_test.ok(ask_test.profile('neo') = 'sub_pool' and ask_test.status('neo', 2) = 'sub_pool' and ask_test.answered('neo', 2),
  'answering for the current session sets your status');
reset role;

-- Captains can change the date, or stop asking.
select ask_test.sign_in('kim');
select public.roster_ask(ask_test.year(), 2, ask_test.today() + 25);
select ask_test.ok(
  (select starts_on = ask_test.today() + 25 from public.session_asks where season_year = ask_test.year() and session = 2),
  'asking again changes the date');
select public.roster_ask(ask_test.year(), 2, null);
select ask_test.ok(ask_test.current() = ask_test.session(1), 'once captains stop asking, the session that just ended is current again');
select public.roster_ask(ask_test.year(), 2, ask_test.today() + 25);
reset role;
select ask_test.ok(ask_test.current() = ask_test.session(2), 'and asking again brings session 2 back');

-- ---------------------------------------------------------------------------
-- Session 2's schedule comes out, and its first game is played.
-- ---------------------------------------------------------------------------

insert into public.games (season_year, session, date, opponent) values
  (ask_test.year(), 2, ask_test.today() - 1, 'Ball Busters'),
  (ask_test.year(), 2, ask_test.today() + 6, 'Grass Kickers');
select ask_test.sign_in('pat');
select ask_test.refused($$select public.roster_answer(ask_test.year(), 2, 'active')$$,
  'answers stop once the session''s first game is played');
reset role;
select ask_test.sign_in('kim');
select ask_test.refused($$select public.roster_ask(ask_test.year(), 2, ask_test.today() + 30)$$,
  'and captains can''t ask about it anymore');
reset role;

set role anon;
select ask_test.refused($$select count(*) from public.session_asks$$, 'signed-out visitors cannot see what was asked');
select ask_test.refused($$select public.roster_answer(ask_test.year(), 2, 'active')$$, 'signed-out visitors cannot answer');
select ask_test.refused($$select public.roster_ask(ask_test.year(), 3, ask_test.today() + 30)$$, 'signed-out visitors cannot ask');
reset role;

rollback;
