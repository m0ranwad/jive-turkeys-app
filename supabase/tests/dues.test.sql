-- Dues database tests: the whole team sees the dues and can mark anyone paid
-- or link a couple; only captains set fees, custom amounts and payment details. Run by
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
-- costs $595 + 7 games × $18 = $721; Dex has a custom $40.
-- ---------------------------------------------------------------------------

delete from public.dues_history;
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

insert into public.dues_payments (season_year, session, user_id, override_amount, paid, paid_date) values
  (2026, 2, dues_test.id('dex'), 40, false, null),
  (2026, 2, dues_test.id('dot'), null, true, '2026-10-03');

create function dues_test.payment(who text) returns public.dues_payments language sql as $$
  select * from public.dues_payments where season_year = 2026 and session = 2 and user_id = dues_test.id(who);
$$;
create function dues_test.partner(who text) returns uuid language sql as $$
  select pays_with from public.player_profiles where user_id = dues_test.id(who);
$$;
grant execute on function dues_test.payment(text), dues_test.partner(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Players: see everything, mark anyone paid, link couples
-- ---------------------------------------------------------------------------

select dues_test.sign_in('dana');
select dues_test.ok((select count(*) from public.session_dues) = 1, 'a player can see the session fee');
select dues_test.ok((select count(*) from public.dues_payments) = 2, 'a player can see who has paid');

select public.mark_dues_paid(2026, 2, array[dues_test.id('dana')], true, '2026-10-09');
select dues_test.ok(
  (select paid and paid_date = '2026-10-09' and paid_by = dues_test.id('dana') from dues_test.payment('dana')),
  'a player can mark themselves paid, and it records who marked it');

select public.mark_dues_paid(2026, 2, array[dues_test.id('dex'), dues_test.id('kim')], true, '2026-10-09');
select dues_test.ok(
  (select paid and paid_by = dues_test.id('dana') and override_amount = 40 from dues_test.payment('dex'))
  and (select paid from dues_test.payment('kim')),
  'a player can mark others paid, two at once, without touching custom amounts');

select public.mark_dues_paid(2026, 2, array[dues_test.id('kim')], false, null);
select dues_test.ok(
  (select not paid and paid_date is null and paid_by is null from dues_test.payment('kim')),
  'a player can mark someone unpaid again');

select public.mark_dues_paid(2026, 2, array[dues_test.id('dot')], true, '2026-10-09');
select dues_test.ok((select paid_date = '2026-10-03' from dues_test.payment('dot'))
  and not exists (select 1 from public.dues_history where user_id = dues_test.id('dot')),
  'marking a paid player paid again keeps their original date and adds no history');

select dues_test.ok(
  (select array_agg(paid order by created_date, paid desc) from public.dues_history where user_id = dues_test.id('kim')) = '{t,f}'
  and (select count(*) from public.dues_history where paid and changed_by = dues_test.id('dana') and paid_date = '2026-10-09') = 3,
  'every change is kept in the history, including the paid date an unmark cleared');
select dues_test.refused($$insert into public.dues_history (season_year, session, user_id, paid) values (2026, 2, dues_test.id('dana'), true)$$,
  'a player cannot add to the history directly');
select dues_test.touches($$update public.dues_history set paid = false$$, 0, 'a player cannot change the history');
select dues_test.touches($$delete from public.dues_history$$, 0, 'a player cannot remove the history');

select dues_test.touches($$update public.dues_payments set override_amount = 1$$, 0, 'a player cannot change amounts');
select dues_test.refused($$insert into public.dues_payments (season_year, session, user_id, override_amount) values (2026, 3, dues_test.id('dana'), 1)$$,
  'a player cannot add a custom amount');
select dues_test.touches($$delete from public.dues_payments$$, 0, 'a player cannot delete payments');
select dues_test.touches($$update public.session_dues set total_fee = 1$$, 0, 'a player cannot change the fee');
select dues_test.touches($$update public.team_settings set pay_venmo = 'not-the-captain'$$, 0, 'a player cannot change how players pay');

select public.set_dues_partner(dues_test.id('dex'), dues_test.id('dot'));
select dues_test.ok(dues_test.partner('dex') = dues_test.id('dot') and dues_test.partner('dot') = dues_test.id('dex'),
  'a player can link a couple who pay together, both ways');
select public.set_dues_partner(dues_test.id('dot'), dues_test.id('dana'));
select dues_test.ok(dues_test.partner('dex') is null and dues_test.partner('dot') = dues_test.id('dana')
  and dues_test.partner('dana') = dues_test.id('dot'), 'relinking a player unlinks their old partner');
select public.set_dues_partner(dues_test.id('dana'), null);
select dues_test.ok(dues_test.partner('dana') is null and dues_test.partner('dot') is null, 'unlinking clears both players');
select dues_test.touches($$update public.player_profiles set display_name = 'Renamed' where user_id = dues_test.id('dex')$$, 0,
  'a player still cannot edit someone else''s profile');
reset role;

-- ---------------------------------------------------------------------------
-- Captains, and signed-out visitors
-- ---------------------------------------------------------------------------

select dues_test.sign_in('kim');
select dues_test.touches($$update public.session_dues set league_fee = 600, total_fee = 726 where session = 2$$, 1,
  'a captain can change the fee breakdown');
select dues_test.touches($$update public.dues_payments set override_amount = 50 where user_id = dues_test.id('dex')$$, 1,
  'a captain can change a custom amount');
select dues_test.touches($$update public.team_settings set pay_venmo = 'kim-pays', pay_paypal = 'kimpays', pay_note = 'Cash at the field works too'$$, 1,
  'a captain can set how players pay');
select dues_test.touches($$delete from public.dues_history$$, 0, 'a captain cannot remove the history either');
reset role;

set role anon;
select dues_test.refused($$select public.mark_dues_paid(2026, 2, array[dues_test.id('dana')], true, null)$$,
  'signed-out visitors cannot mark anyone paid');
select dues_test.refused($$select public.set_dues_partner(dues_test.id('dana'), dues_test.id('dex'))$$,
  'signed-out visitors cannot link players');
select dues_test.refused($$select count(*) from public.dues_payments$$, 'signed-out visitors cannot see who has paid');
reset role;

rollback;
