-- Dues database tests: what a player can see of the dues (only their own
-- share, through public.my_dues()) and who can change them. Run by
-- scripts/test-db.sh after every migration is applied. Everything happens in
-- one transaction that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema dues_test;
grant usage on schema dues_test to authenticated, anon;

create table dues_test.people (name text primary key, id uuid not null);
grant select on dues_test.people to authenticated, anon;

create function dues_test.id(who text) returns uuid language sql stable as $$
  select id from dues_test.people where name = who;
$$;

create function dues_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function dues_test.refused(statement text, what text) returns void language plpgsql as $$
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
create function dues_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema dues_test to authenticated, anon;

create function dues_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', dues_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- A captain, three more active players and one in the sub pool. Session 2
-- costs $595 + 7 games × $18 = $721; Dex has a custom $40, so the other three
-- split $681: $227 each, rounded up. tests/unit/dues.test.js checks the
-- same numbers against the page's own split.
-- ---------------------------------------------------------------------------

delete from public.dues_payments;
delete from public.session_dues;
delete from public.player_profiles;

insert into dues_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000d1'),
  ('dana', '00000000-0000-4000-8000-0000000000d2'),
  ('dex', '00000000-0000-4000-8000-0000000000d3'),
  ('dot', '00000000-0000-4000-8000-0000000000d4'),
  ('sub', '00000000-0000-4000-8000-0000000000d5');

insert into auth.users (id, email) select id, name || '@dues.test' from dues_test.people;
update public.users set role = case when id = dues_test.id('kim') then 'admin' else 'user' end
  where id in (select id from dues_test.people);

insert into public.player_profiles (user_id, display_name, status)
select id, initcap(name), case when name = 'sub' then 'sub_pool' else 'active' end from dues_test.people;

insert into public.session_dues (season_year, session, total_fee, league_fee, ref_fee, game_count) values
  (2026, 2, 721, 595, 18, 7);
-- Saved before the fee breakdown existed: a total only.
insert into public.session_dues (season_year, session, total_fee) values (2026, 1, 300);

insert into public.dues_payments (season_year, session, user_id, override_amount, paid, paid_date) values
  (2026, 2, dues_test.id('dex'), 40, false, null),
  (2026, 2, dues_test.id('dot'), null, true, '2026-10-03'),
  (2026, 1, dues_test.id('dana'), null, true, '2026-08-01');

-- ---------------------------------------------------------------------------
-- What each player sees
-- ---------------------------------------------------------------------------

select dues_test.sign_in('dana');
select dues_test.ok(
  (select array_agg(session order by ord) from (select session, row_number() over () as ord from public.my_dues()) x) = '{2,1}',
  'a player sees every session with dues set, newest first');
select dues_test.ok(
  (select total_fee = 721 and league_fee = 595 and ref_fee = 18 and game_count = 7 from public.my_dues() where session = 2),
  'a player sees how the fee is made up');
select dues_test.ok(
  (select active_players = 4 and per_player = 227 and is_active and not custom and amount = 227 and not paid
   from public.my_dues() where session = 2),
  'a player sees their even share after custom amounts, rounded up');
select dues_test.ok(
  (select paid from public.my_dues() where session = 1) and (select amount from public.my_dues() where session = 1) = 75,
  'a player sees their own payment for an older session (saved as a total only)');
select dues_test.ok((select count(*) from public.dues_payments) = 0, 'a player still cannot read anyone''s payment rows');
select dues_test.ok((select count(*) from public.session_dues) = 0, 'a player still cannot read the dues table directly');
select dues_test.touches($$update public.dues_payments set paid = true$$, 0, 'a player cannot mark anyone paid, themselves included');
select dues_test.refused($$insert into public.dues_payments (season_year, session, user_id, paid) values (2026, 3, dues_test.id('dana'), true)$$,
  'a player cannot add a payment');
select dues_test.touches($$update public.session_dues set total_fee = 1$$, 0, 'a player cannot change the fee');
select dues_test.touches($$update public.team_settings set pay_venmo = 'not-the-captain'$$, 0, 'a player cannot change how players pay');
reset role;

select dues_test.sign_in('dex');
select dues_test.ok((select custom and amount = 40 and not paid from public.my_dues() where session = 2),
  'a player with a custom amount sees that amount');
reset role;

select dues_test.sign_in('dot');
select dues_test.ok((select paid and paid_date = '2026-10-03' and amount = 227 from public.my_dues() where session = 2),
  'a player marked paid sees it, with the date');
reset role;

select dues_test.sign_in('sub');
select dues_test.ok((select not is_active and amount is null and not paid from public.my_dues() where session = 2),
  'a sub pool player owes nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Captains, and signed-out visitors
-- ---------------------------------------------------------------------------

select dues_test.sign_in('kim');
select dues_test.touches($$update public.session_dues set league_fee = 600, total_fee = 726 where session = 2$$, 1,
  'a captain can change the fee breakdown');
select dues_test.ok((select per_player from public.my_dues() where session = 2) = 229, 'the split follows the new fee');
select dues_test.touches($$update public.team_settings set pay_venmo = 'kim-pays', pay_note = 'Cash at the field works too'$$, 1,
  'a captain can set how players pay');
select dues_test.ok((select count(*) from public.dues_payments) = 3, 'a captain sees every payment');
reset role;

set role anon;
select dues_test.refused($$select * from public.my_dues()$$, 'signed-out visitors cannot see dues');
reset role;

rollback;
