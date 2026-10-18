-- The record of what moves everyone's share (dues_changes): the session fee,
-- custom amounts, and players coming onto or off a session's active roster.
-- The database writes it; the whole team reads it; nobody edits or removes it.
-- Run by scripts/test-db.sh after every migration is applied. Everything
-- happens in one transaction that's rolled back.

begin;

create schema changes_test;
grant usage on schema changes_test to authenticated, anon;

create table changes_test.people (name text primary key, id uuid not null);
grant select on changes_test.people to authenticated, anon;

create function changes_test.id(who text) returns uuid language sql stable as $$
  select id from changes_test.people where name = who;
$$;

create function changes_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function changes_test.refused(statement text, what text) returns void language plpgsql as $$
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

create function changes_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema changes_test to authenticated, anon;

create function changes_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', changes_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- How many changes of a kind there are. (Everything here runs in one transaction, so they all have the same time.)
create function changes_test.count(p_kind text) returns integer language sql as $$
  select count(*)::integer from public.dues_changes where kind = p_kind;
$$;
grant execute on function changes_test.count(text) to authenticated;

delete from public.dues_history;
delete from public.dues_payments;
delete from public.session_dues;
delete from public.session_roster;
delete from public.player_profiles;

-- Kim is a captain, Dana and Dex play, Nia signed up but hasn't entered the team code.
insert into changes_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000f1'),
  ('dana', '00000000-0000-4000-8000-0000000000f2'),
  ('dex', '00000000-0000-4000-8000-0000000000f3'),
  ('nia', '00000000-0000-4000-8000-0000000000f4');
insert into auth.users (id, email) select id, name || '@changes.test' from changes_test.people;
update public.users set role = case when id = changes_test.id('kim') then 'admin' else 'user' end,
  joined_team_at = case when id = changes_test.id('nia') then null else now() end
  where id in (select id from changes_test.people);
insert into public.player_profiles (user_id, display_name, status)
select id, initcap(name), 'active' from changes_test.people where name <> 'nia';
delete from public.dues_changes;
delete from public.session_roster;

-- ---------------------------------------------------------------------------
-- The session fee
-- ---------------------------------------------------------------------------

select changes_test.sign_in('kim');
insert into public.session_dues (season_year, session, league_fee, ref_fee, game_count, total_fee) values (2026, 2, 595, 0, 7, 595);
select changes_test.ok(
  (select old_value is null and (new_value ->> 'total_fee')::numeric = 595 and changed_by = changes_test.id('kim')
     and season_year = 2026 and session = 2 and user_id is null and guest_id is null
   from public.dues_changes where kind = 'fee'),
  'setting a session fee is recorded, with who set it');

update public.session_dues set ref_fee = 18, total_fee = 721 where session = 2;
select changes_test.ok(
  (select (old_value ->> 'total_fee')::numeric = 595 and (old_value ->> 'ref_fee')::numeric = 0
     and (new_value ->> 'total_fee')::numeric = 721 and (new_value ->> 'ref_fee')::numeric = 18
   from public.dues_changes where kind = 'fee' and old_value is not null)
  and changes_test.count('fee') = 2,
  'changing it keeps what it was and what it is now');

update public.session_dues set total_fee = 721 where session = 2;
select changes_test.ok(changes_test.count('fee') = 2, 'saving the same fee again adds nothing');

-- ---------------------------------------------------------------------------
-- Custom amounts
-- ---------------------------------------------------------------------------

insert into public.dues_payments (season_year, session, user_id, override_amount) values (2026, 2, changes_test.id('dex'), 40);
select changes_test.ok(
  (select old_value is null and (new_value ->> 'amount')::numeric = 40 and user_id = changes_test.id('dex')
   from public.dues_changes where kind = 'custom_amount'),
  'giving a player a custom amount is recorded for that player');
update public.dues_payments set override_amount = 45 where user_id = changes_test.id('dex');
select changes_test.ok(
  exists (select 1 from public.dues_changes where kind = 'custom_amount'
    and (old_value ->> 'amount')::numeric = 40 and (new_value ->> 'amount')::numeric = 45),
  'changing it keeps the old amount and the new one');
update public.dues_payments set override_amount = null where user_id = changes_test.id('dex');
select changes_test.ok(
  exists (select 1 from public.dues_changes where kind = 'custom_amount' and (old_value ->> 'amount')::numeric = 45 and new_value is null)
  and changes_test.count('custom_amount') = 3,
  'putting them back on the even split is recorded too');
reset role;

select changes_test.sign_in('dana');
select public.mark_dues_paid(2026, 2, array[changes_test.id('dana'), changes_test.id('dex')], true, '2026-10-09', array[61, 61]::numeric[]);
select changes_test.ok(changes_test.count('custom_amount') = 3 and changes_test.count('fee') = 2,
  'marking players paid is not a change to anyone''s share');
reset role;

-- ---------------------------------------------------------------------------
-- Session rosters
-- ---------------------------------------------------------------------------

select public.roster_start_session(2026, 2);
select changes_test.ok(changes_test.count('roster') = 0 and (select count(*) from public.session_roster where session = 2) = 3,
  'a session''s list starting as a copy of everyone''s status is not a change');

select changes_test.sign_in('kim');
update public.session_roster set status = 'on_break', answered_at = now(), changed_by = changes_test.id('kim')
  where session = 2 and user_id = changes_test.id('dana');
select changes_test.ok(
  (select old_value ->> 'status' = 'active' and new_value ->> 'status' = 'on_break'
     and user_id = changes_test.id('dana') and changed_by = changes_test.id('kim') and session = 2
   from public.dues_changes where kind = 'roster'),
  'a captain taking someone off the active list of a session is recorded');
update public.session_roster set status = 'sub_pool' where session = 2 and user_id = changes_test.id('dana');
update public.session_roster set status = 'active', answered_at = now() where session = 2 and user_id = changes_test.id('dex');
select changes_test.ok(changes_test.count('roster') = 1,
  'moving between sitting out and the sub pool, or confirming someone who is already playing, changes no split');
update public.session_roster set status = 'active' where session = 2 and user_id = changes_test.id('dana');
select changes_test.ok(
  exists (select 1 from public.dues_changes where kind = 'roster' and old_value ->> 'status' = 'sub_pool' and new_value ->> 'status' = 'active')
  and changes_test.count('roster') = 2,
  'coming back onto the active list is recorded');
reset role;

-- A player says they're sitting out the current session (2026 session 1: there are no games), whose
-- list started when the site opened.
select public.roster_start_session(2026, 1);
select changes_test.sign_in('dex');
select changes_test.touches($$update public.player_profiles set status = 'on_break' where user_id = changes_test.id('dex')$$, 1,
  'a player sets themselves to On Break');
select changes_test.ok(
  (select new_value ->> 'status' = 'on_break' and changed_by = changes_test.id('dex') and session = 1
   from public.dues_changes where kind = 'roster' and user_id = changes_test.id('dex')),
  'and it is recorded for the current session, as theirs');

-- ---------------------------------------------------------------------------
-- Who can see and change the record
-- ---------------------------------------------------------------------------

select changes_test.ok((select count(*) from public.dues_changes) = 8, 'a player sees every change');
select changes_test.refused($$insert into public.dues_changes (season_year, session, kind) values (2026, 2, 'fee')$$,
  'a player cannot add to the record');
select changes_test.touches($$update public.dues_changes set changed_by = null$$, 0, 'a player cannot change the record');
select changes_test.touches($$delete from public.dues_changes$$, 0, 'a player cannot remove the record');
reset role;

select changes_test.sign_in('kim');
select changes_test.touches($$update public.dues_changes set changed_by = null$$, 0, 'a captain cannot change the record either');
select changes_test.touches($$delete from public.dues_changes$$, 0, 'or remove it');
reset role;

select changes_test.sign_in('nia');
select changes_test.ok((select count(*) from public.dues_changes) = 0, 'someone who has not entered the team code sees none of it');
reset role;

set role anon;
select changes_test.refused($$select count(*) from public.dues_changes$$, 'signed-out visitors cannot see it');
reset role;

-- ---------------------------------------------------------------------------
-- Roster names
-- ---------------------------------------------------------------------------

select changes_test.sign_in('kim');
insert into public.team_guests (display_name, created_by) values ('Rosa Diaz', changes_test.id('kim'));
reset role;
insert into changes_test.people select 'rosa', id from public.team_guests where display_name = 'Rosa Diaz';
select changes_test.sign_in('kim');
insert into public.dues_payments (season_year, session, guest_id, override_amount) values (2026, 2, changes_test.id('rosa'), 30);
select changes_test.ok(
  exists (select 1 from public.dues_changes where kind = 'custom_amount' and guest_id = changes_test.id('rosa') and user_id is null),
  'a roster name''s custom amount is recorded for them');
update public.team_guests set removed = true where id = changes_test.id('rosa');
select changes_test.ok(
  exists (select 1 from public.dues_changes where kind = 'roster' and guest_id = changes_test.id('rosa') and new_value ->> 'status' = 'off'),
  'and taking them off the team is recorded as coming off the roster');
reset role;

insert into changes_test.people values ('rosa_app', '00000000-0000-4000-8000-0000000000f5');
insert into auth.users (id, email) values (changes_test.id('rosa_app'), 'rosa@changes.test');
update public.users set joined_team_at = now() where id = changes_test.id('rosa_app');
insert into public.player_profiles (user_id, display_name) values (changes_test.id('rosa_app'), 'Rosa');
update public.team_guests set removed = false where id = changes_test.id('rosa');
select changes_test.sign_in('kim');
select public.link_team_guest(changes_test.id('rosa'), changes_test.id('rosa_app'));
select changes_test.ok(
  not exists (select 1 from public.dues_changes where guest_id = changes_test.id('rosa'))
  and (select count(*) from public.dues_changes where user_id = changes_test.id('rosa_app') and kind = 'custom_amount') = 1,
  'when a roster name joins, their changes move to their account');
reset role;

rollback;
