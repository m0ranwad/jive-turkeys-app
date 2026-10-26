-- Couples database tests: each session keeps who paid with whom, so linking or
-- unlinking a couple now never rewrites a session that's over (#83). Run by
-- scripts/test-db.sh after every migration is applied. Everything happens in
-- one transaction that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema couples_test;
grant usage on schema couples_test to authenticated, anon;

create table couples_test.people (name text primary key, id uuid not null);
grant select on couples_test.people to authenticated, anon;

create function couples_test.id(who text) returns uuid language sql stable as $$
  select id from couples_test.people where name = who;
$$;

create function couples_test.today() returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date;
$$;

create function couples_test.year() returns integer language sql stable as $$
  select extract(year from couples_test.today())::integer;
$$;

-- Who someone pays with in a session of this year's: a name, 'nobody', or 'not on it'.
create function couples_test.partner(who text, s integer) returns text language sql stable as $$
  select coalesce(
    (select coalesce((select p.name from couples_test.people p where p.id = coalesce(r.pays_with_user, r.pays_with_guest)), 'nobody')
     from public.session_roster r
     where r.season_year = couples_test.year() and r.session = s and couples_test.id(who) in (r.user_id, r.guest_id)),
    'not on it');
$$;

-- Who someone pays with from now on (their profile, or their roster name).
create function couples_test.now_with(who text) returns text language sql stable as $$
  select coalesce((select p.name from couples_test.people p where p.id = public.dues_partner_of(couples_test.id(who))), 'nobody');
$$;

create function couples_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function couples_test.refused(statement text, what text) returns void language plpgsql as $$
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
create function couples_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema couples_test to authenticated, anon;

create function couples_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', couples_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain; Pat, Lee, Ann and Cal play. Gus and Mo are on the roster
-- but haven't joined the app. Session 1 is under way: its first game was three
-- weeks ago and its last is today.
-- ---------------------------------------------------------------------------

insert into couples_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000d1'),
  ('pat', '00000000-0000-4000-8000-0000000000d2'),
  ('lee', '00000000-0000-4000-8000-0000000000d3'),
  ('ann', '00000000-0000-4000-8000-0000000000d4'),
  ('cal', '00000000-0000-4000-8000-0000000000d5'),
  ('neo', '00000000-0000-4000-8000-0000000000d6'),
  ('bo', '00000000-0000-4000-8000-0000000000d7'),
  ('ori', '00000000-0000-4000-8000-0000000000d8'),
  ('gus', '00000000-0000-4000-8000-0000000000e1'),
  ('mo', '00000000-0000-4000-8000-0000000000e2');

insert into auth.users (id, email)
  select id, name || '@couples.test' from couples_test.people where name not in ('gus', 'mo');
update public.users set role = case when id = couples_test.id('kim') then 'admin' else 'user' end, joined_team_at = now()
  where id in (select id from couples_test.people);

insert into public.games (season_year, session, date, opponent) values
  (couples_test.year(), 1, couples_test.today() - 20, 'Net Ninjas'),
  (couples_test.year(), 1, couples_test.today(), 'Grass Kickers');

insert into public.player_profiles (user_id, display_name, gender, status) values
  (couples_test.id('kim'), 'Kim Captain', 'F', 'active'),
  (couples_test.id('pat'), 'Pat Player', 'M', 'active'),
  (couples_test.id('lee'), 'Lee Lane', 'F', 'active'),
  (couples_test.id('ann'), 'Ann Avery', 'F', 'active'),
  (couples_test.id('cal'), 'Cal Cole', 'M', 'active');
insert into public.team_guests (id, display_name, gender, status) values
  (couples_test.id('gus'), 'Gus Guest', 'M', 'active'),
  (couples_test.id('mo'), 'Mo Name', 'M', 'active');

select couples_test.sign_in('pat');
select public.set_dues_partner(auth.uid(), couples_test.id('lee'));
select public.set_dues_partner(couples_test.id('cal'), couples_test.id('mo'));
reset role;
select couples_test.ok(
  couples_test.partner('pat', 1) = 'lee' and couples_test.partner('lee', 1) = 'pat'
    and couples_test.partner('cal', 1) = 'mo' and couples_test.partner('mo', 1) = 'cal'
    and couples_test.partner('ann', 1) = 'nobody',
  'a couple linked while a session is under way pays together in it, roster names included');
select couples_test.ok(
  (select pays_with_user is null and pays_with_guest = couples_test.id('mo')
   from public.session_roster where session = 1 and user_id = couples_test.id('cal'))
    and (select pays_with_user = couples_test.id('cal') and pays_with_guest is null
         from public.session_roster where session = 1 and guest_id = couples_test.id('mo')),
  'each side points at the other in the column for its kind');

-- ---------------------------------------------------------------------------
-- Session 1's last game is played and session 2 goes on the schedule.
-- ---------------------------------------------------------------------------

update public.games set date = couples_test.today() - 5 where opponent = 'Grass Kickers';
insert into public.games (season_year, session, date, opponent) values
  (couples_test.year(), 2, couples_test.today() + 3, 'Goal Diggers'),
  (couples_test.year(), 2, couples_test.today() + 10, 'Ball Busters');

select couples_test.sign_in('ann');
select public.roster_start_current();
reset role;
select couples_test.ok(
  couples_test.partner('pat', 2) = 'lee' and couples_test.partner('lee', 2) = 'pat' and couples_test.partner('cal', 2) = 'mo',
  'a new session starts with the couples from before');

-- Pat and Lee pay on their own from session 2. Ann starts paying with Gus.
select couples_test.sign_in('pat');
select public.set_dues_partner(auth.uid(), null);
select public.set_dues_partner(couples_test.id('ann'), couples_test.id('gus'));
reset role;
select couples_test.ok(
  couples_test.partner('pat', 2) = 'nobody' and couples_test.partner('lee', 2) = 'nobody'
    and couples_test.partner('ann', 2) = 'gus' and couples_test.partner('gus', 2) = 'ann',
  'unlinking and linking in session 2 counts for session 2');
select couples_test.ok(
  couples_test.partner('pat', 1) = 'lee' and couples_test.partner('lee', 1) = 'pat'
    and couples_test.partner('ann', 1) = 'nobody' and couples_test.partner('gus', 1) = 'nobody',
  'and session 1 keeps who paid together then');

-- New player Neo joins in session 2 and pays with Bo.
select couples_test.sign_in('neo');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Neo New', 'M', 'active');
reset role;
select couples_test.sign_in('bo');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Bo Brand', 'F', 'active');
select public.set_dues_partner(auth.uid(), couples_test.id('neo'));
reset role;
select couples_test.ok(couples_test.partner('neo', 2) = 'bo' and couples_test.partner('neo', 1) = 'not on it',
  'a new player''s couple counts in the session they joined in');

-- ---------------------------------------------------------------------------
-- Captains ask about session 3 ahead. Its list follows who pays together now.
-- ---------------------------------------------------------------------------

select couples_test.sign_in('kim');
select public.roster_ask(couples_test.year(), 3, couples_test.today() + 30);
reset role;
select couples_test.ok(
  couples_test.partner('ann', 3) = 'gus' and couples_test.partner('neo', 3) = 'bo' and couples_test.partner('pat', 3) = 'nobody',
  'a session asked about ahead starts with today''s couples');

-- Lee pays with Kim now. Linking while viewing session 3 counts from session 2 on, not session 1.
select couples_test.sign_in('lee');
select public.set_dues_partner(auth.uid(), couples_test.id('kim'));
reset role;
select couples_test.ok(
  couples_test.partner('lee', 2) = 'kim' and couples_test.partner('kim', 2) = 'lee'
    and couples_test.partner('lee', 3) = 'kim' and couples_test.partner('kim', 3) = 'lee'
    and couples_test.partner('lee', 1) = 'pat' and couples_test.partner('kim', 1) = 'nobody',
  'a link counts for the session being played and the ones after it, never the ones before');

-- ---------------------------------------------------------------------------
-- Captains correct a past session's couples. Only that session changes.
-- ---------------------------------------------------------------------------

select couples_test.sign_in('pat');
select couples_test.refused(
  $$select public.set_session_partner(couples_test.year(), 1, auth.uid(), couples_test.id('ann'))$$,
  'only captains change who paid together in a past session');
select couples_test.touches(
  $$update public.session_roster set pays_with_user = couples_test.id('ann') where session = 1 and user_id = auth.uid()$$, 0,
  'and players can''t edit the session lists directly');
reset role;
select couples_test.ok(couples_test.partner('pat', 1) = 'lee', 'so Pat still paid with Lee in session 1');

select couples_test.sign_in('kim');
select couples_test.refused(
  $$select public.set_session_partner(couples_test.year(), 2, couples_test.id('pat'), couples_test.id('ann'))$$,
  'a session being played follows who pays together now');
select couples_test.refused(
  $$select public.set_session_partner(couples_test.year(), 3, couples_test.id('pat'), couples_test.id('ann'))$$,
  'and so does one asked about ahead');
select couples_test.refused(
  $$select public.set_session_partner(couples_test.year(), 1, couples_test.id('neo'), couples_test.id('pat'))$$,
  'both have to have been on that session');
select public.set_session_partner(couples_test.year(), 1, couples_test.id('ann'), couples_test.id('pat'));
reset role;
select couples_test.ok(
  couples_test.partner('ann', 1) = 'pat' and couples_test.partner('pat', 1) = 'ann' and couples_test.partner('lee', 1) = 'nobody',
  'a captain links a couple in session 1; whoever either paid with there pays on their own');
select couples_test.ok(
  couples_test.partner('ann', 2) = 'gus' and couples_test.partner('pat', 2) = 'nobody' and couples_test.partner('lee', 2) = 'kim'
    and couples_test.now_with('ann') = 'gus' and couples_test.now_with('pat') = 'nobody',
  'other sessions and who pays together now don''t change');

select couples_test.sign_in('kim');
insert into public.session_roster (season_year, session, user_id, status, answered_at, changed_by)
  values (couples_test.year(), 1, couples_test.id('bo'), 'active', now(), auth.uid());
select public.set_session_partner(couples_test.year(), 1, couples_test.id('pat'), null);
reset role;
select couples_test.ok(couples_test.partner('bo', 1) = 'nobody',
  'adding someone to a past session doesn''t bring their couple from now');
select couples_test.ok(couples_test.partner('pat', 1) = 'nobody' and couples_test.partner('ann', 1) = 'nobody',
  'a captain unlinks a couple in session 1');

-- ---------------------------------------------------------------------------
-- Between sessions: session 2's games are all played, nothing else is on the
-- schedule and captains stopped asking about session 3. A link counts from the
-- next session; session 2 keeps who paid together.
-- ---------------------------------------------------------------------------

update public.games set date = couples_test.today() - 2 where opponent in ('Goal Diggers', 'Ball Busters');
select couples_test.sign_in('kim');
select public.roster_ask(couples_test.year(), 3, null);
reset role;
select couples_test.ok((select open_year is null from public.roster_open_session()), 'session 2 is over');

select couples_test.sign_in('pat');
select public.set_dues_partner(auth.uid(), couples_test.id('ann'));
reset role;
select couples_test.ok(
  couples_test.partner('pat', 2) = 'nobody' and couples_test.partner('ann', 2) = 'gus' and couples_test.partner('gus', 2) = 'ann',
  'a couple linked between sessions leaves the session that''s over as it was');
select couples_test.ok(couples_test.now_with('pat') = 'ann' and couples_test.now_with('gus') = 'nobody',
  'it''s who pays together from now on');

select couples_test.sign_in('kim');
select public.set_session_partner(couples_test.year(), 2, couples_test.id('gus'), null);
reset role;
select couples_test.ok(couples_test.partner('gus', 2) = 'nobody' and couples_test.partner('ann', 2) = 'nobody',
  'captains correct the session that''s over like any past one');

-- Session 3 goes on the schedule and starts.
insert into public.games (season_year, session, date, opponent) values
  (couples_test.year(), 3, couples_test.today() + 5, 'Kick Six');
select couples_test.sign_in('ann');
select public.roster_start_current();
reset role;
select couples_test.ok(
  couples_test.partner('pat', 3) = 'ann' and couples_test.partner('ann', 3) = 'pat' and couples_test.partner('gus', 3) = 'nobody'
    and couples_test.partner('lee', 3) = 'kim' and couples_test.partner('cal', 3) = 'mo',
  'the next session starts with the couples linked between sessions');

-- ---------------------------------------------------------------------------
-- Ori joins in session 3 and picks "Mo Name", who paid with Cal in sessions 1
-- to 3. Then a captain undoes the pick.
-- ---------------------------------------------------------------------------

select couples_test.sign_in('ori');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Mo Ortiz', 'M', 'active');
select public.claim_team_guest(couples_test.id('mo'));
reset role;
select couples_test.ok(
  couples_test.partner('ori', 1) = 'cal' and couples_test.partner('cal', 1) = 'ori'
    and couples_test.partner('ori', 2) = 'cal' and couples_test.partner('cal', 2) = 'ori'
    and couples_test.partner('ori', 3) = 'cal' and couples_test.partner('cal', 3) = 'ori',
  'picking a roster name brings its couple to the account, in every session');
select couples_test.ok(
  (select cardinality(moved_partners) = 3 from public.team_guest_links where guest_id = couples_test.id('mo')),
  'and the pick records whose partner it changed');

select couples_test.sign_in('kim');
select public.unlink_team_guest(couples_test.id('mo'));
reset role;
select couples_test.ok(
  couples_test.partner('mo', 1) = 'cal' and couples_test.partner('cal', 1) = 'mo'
    and couples_test.partner('mo', 2) = 'cal' and couples_test.partner('cal', 2) = 'mo'
    and couples_test.partner('mo', 3) = 'cal' and couples_test.partner('cal', 3) = 'mo'
    and couples_test.partner('ori', 3) = 'nobody' and couples_test.now_with('cal') = 'mo',
  'undoing the pick gives the couple back to the roster name, in every session');

rollback;
