-- Session roster database tests: each session keeps its own list of who's on
-- the team, so a status change in one session never rewrites another. Run by
-- scripts/test-db.sh after every migration is applied. Everything happens in
-- one transaction that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema roster_test;
grant usage on schema roster_test to authenticated, anon;

create table roster_test.people (name text primary key, id uuid not null);
grant select on roster_test.people to authenticated, anon;

create function roster_test.id(who text) returns uuid language sql stable as $$
  select id from roster_test.people where name = who;
$$;

create function roster_test.today() returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date;
$$;

create function roster_test.year() returns integer language sql stable as $$
  select extract(year from roster_test.today())::integer;
$$;

-- Someone's status in a session of this year's, or 'none' if they aren't on it.
create function roster_test.status(who text, s integer) returns text language sql stable as $$
  select coalesce(
    (select r.status from public.session_roster r
     where r.season_year = roster_test.year() and r.session = s and roster_test.id(who) in (r.user_id, r.guest_id)),
    'none');
$$;

create function roster_test.answered(who text, s integer) returns boolean language sql stable as $$
  select r.answered_at is not null from public.session_roster r
  where r.season_year = roster_test.year() and r.session = s and roster_test.id(who) in (r.user_id, r.guest_id);
$$;

create function roster_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function roster_test.refused(statement text, what text) returns void language plpgsql as $$
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
create function roster_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema roster_test to authenticated, anon;

create function roster_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', roster_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain, Pat and Lee play, and Gus and Val are on the roster but
-- haven't joined the app. Session 1 is under way: its game was three weeks ago
-- and nothing else is on the schedule yet.
-- ---------------------------------------------------------------------------

insert into roster_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000e1'),
  ('pat', '00000000-0000-4000-8000-0000000000e2'),
  ('lee', '00000000-0000-4000-8000-0000000000e3'),
  ('neo', '00000000-0000-4000-8000-0000000000e4'),
  ('vic', '00000000-0000-4000-8000-0000000000e5'),
  ('gus', '00000000-0000-4000-8000-0000000000e6'),
  ('val', '00000000-0000-4000-8000-0000000000e7');

insert into auth.users (id, email)
  select id, name || '@roster.test' from roster_test.people where name in ('kim', 'pat', 'lee', 'neo', 'vic');
update public.users set role = case when id = roster_test.id('kim') then 'admin' else 'user' end
  where id in (select id from roster_test.people);
-- Everyone here has joined the team with its code (membership.test.sql covers who hasn't).
update public.users set joined_team_at = now();

insert into public.games (season_year, session, date, opponent)
  values (roster_test.year(), 1, roster_test.today() - 20, 'Net Ninjas');

insert into public.player_profiles (user_id, display_name, gender, status) values
  (roster_test.id('kim'), 'Kim Captain', 'F', 'active'),
  (roster_test.id('pat'), 'Pat Player', 'M', 'active'),
  (roster_test.id('lee'), 'Lee Sub', 'M', 'sub_pool');
insert into public.team_guests (id, display_name, gender, status) values
  (roster_test.id('gus'), 'Gus Guest', 'M', 'active'),
  (roster_test.id('val'), 'Val Guest', 'F', 'on_break');

select roster_test.ok(
  roster_test.status('kim', 1) = 'active' and roster_test.status('pat', 1) = 'active'
    and roster_test.status('lee', 1) = 'sub_pool' and roster_test.status('gus', 1) = 'active'
    and roster_test.status('val', 1) = 'on_break',
  'players and roster names are on the current session with their status');
select roster_test.ok((select count(*) = 5 from public.session_roster), 'once each');

-- ---------------------------------------------------------------------------
-- Session 2 goes on the schedule, so it's next.
-- ---------------------------------------------------------------------------

insert into public.games (season_year, session, date, opponent) values
  (roster_test.year(), 2, roster_test.today() + 3, 'Goal Diggers'),
  (roster_test.year(), 2, roster_test.today() + 10, 'Ball Busters');

select roster_test.sign_in('pat');
select roster_test.ok(
  public.roster_start_current() = jsonb_build_object('season_year', roster_test.year(), 'session', 2),
  'the next game decides the current session');
select roster_test.ok(
  roster_test.status('kim', 2) = 'active' and roster_test.status('pat', 2) = 'active'
    and roster_test.status('lee', 2) = 'sub_pool' and roster_test.status('gus', 2) = 'active'
    and roster_test.status('val', 2) = 'on_break',
  'a new session starts with everyone''s status carried over');
select roster_test.ok(
  not exists (select 1 from public.session_roster where session = 2 and answered_at is not null),
  'carried-over statuses wait for each player''s answer');
select public.roster_start_current();
select roster_test.ok((select count(*) = 5 from public.session_roster where session = 2), 'starting it again changes nothing');

select roster_test.touches($$update public.player_profiles set status = 'on_break' where user_id = auth.uid()$$, 1,
  'a player sits out session 2');
select roster_test.ok(roster_test.status('pat', 2) = 'on_break' and roster_test.answered('pat', 2),
  'it counts for the current session, as their answer');
select roster_test.ok(roster_test.status('pat', 1) = 'active', 'the session before keeps the status they had then');
select roster_test.touches($$update public.player_profiles set status = 'sub_pool' where user_id = roster_test.id('lee')$$, 0,
  'a player cannot change someone else''s status');
select roster_test.touches($$update public.session_roster set status = 'active' where user_id = auth.uid()$$, 0,
  'players cannot edit the session lists directly');
select roster_test.refused(
  $$insert into public.session_roster (season_year, session, user_id, status) values (roster_test.year(), 1, auth.uid(), 'on_break')$$,
  'players cannot add themselves to a session directly');
select roster_test.refused($$select public.roster_start_session(roster_test.year(), 5)$$, 'players cannot start a session directly');
reset role;

-- Lee answers before the first game: confirming the status carried over.
select roster_test.sign_in('lee');
select roster_test.touches($$update public.player_profiles set status = 'sub_pool' where user_id = auth.uid()$$, 1,
  'a player confirms the status carried over');
select roster_test.ok(roster_test.status('lee', 2) = 'sub_pool' and roster_test.answered('lee', 2), 'that counts as their answer');
reset role;

select roster_test.sign_in('kim');
select roster_test.touches($$update public.team_guests set status = 'on_break' where id = roster_test.id('gus')$$, 1,
  'a captain answers for a roster name');
select roster_test.ok(
  roster_test.status('gus', 2) = 'on_break' and roster_test.answered('gus', 2)
    and (select changed_by = roster_test.id('kim') from public.session_roster where session = 2 and guest_id = roster_test.id('gus')),
  'it counts for the current session, marked as the captain''s');
select roster_test.touches($$update public.team_guests set removed = true where id = roster_test.id('gus')$$, 1,
  'a captain takes a roster name off the team');
select roster_test.ok(roster_test.status('gus', 2) = 'off' and roster_test.status('gus', 1) = 'active',
  'they are off the current session, and still on the one before');
select roster_test.touches(
  $$update public.session_roster set status = 'on_break' where session = 1 and user_id = roster_test.id('lee')$$, 1,
  'a captain corrects a past session');
select roster_test.ok(roster_test.status('lee', 1) = 'on_break' and roster_test.status('lee', 2) = 'sub_pool',
  'the correction changes only that session');
reset role;

-- ---------------------------------------------------------------------------
-- New players in session 2.
-- ---------------------------------------------------------------------------

select roster_test.sign_in('neo');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Neo New', 'M', 'active');
select roster_test.ok(roster_test.status('neo', 2) = 'active' and roster_test.status('neo', 1) = 'none',
  'a new player is on the session they joined in, and not the ones before');
reset role;

-- Vic joins and picks Val's name: Val was on session 1 (on break) and session 2.
select roster_test.sign_in('vic');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Vic Val', 'F', 'active');
select public.claim_team_guest(roster_test.id('val'));
select roster_test.ok(roster_test.status('vic', 1) = 'on_break', 'picking your name brings its past sessions to your account');
select roster_test.ok(roster_test.status('vic', 2) = 'on_break', 'and its status for this session');
select roster_test.ok(
  not exists (select 1 from public.session_roster where session = 1 and guest_id = roster_test.id('val')),
  'past sessions move rather than being copied');
reset role;

-- A later session leaves out roster names that were taken off the team or have joined.
select public.roster_start_session(roster_test.year(), 3);
select roster_test.ok(
  roster_test.status('gus', 3) = 'none' and roster_test.status('val', 3) = 'none'
    and roster_test.status('vic', 3) = 'on_break' and roster_test.status('pat', 3) = 'on_break'
    and roster_test.status('neo', 3) = 'active',
  'a new session leaves out roster names that were removed or have joined');
select roster_test.ok(
  (select count(*) = 1 from public.session_roster where session = 1 and user_id = roster_test.id('pat'))
    and roster_test.status('pat', 1) = 'active' and roster_test.status('gus', 1) = 'active',
  'session 1 is still exactly as it was');

set role anon;
select roster_test.refused($$select count(*) from public.session_roster$$, 'signed-out visitors cannot see the session lists');
select roster_test.refused($$select public.roster_start_current()$$, 'signed-out visitors cannot start a session');
reset role;

rollback;
