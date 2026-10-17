-- Dues shares as the database works them out (dues_shares()), and locking in
-- what payments marked before amounts were recorded count as
-- (dues_fill_paid_amounts()). The site splits the same way:
-- tests/unit/dues.test.js checks the same people and numbers ("the database
-- splits the same way"). Run by scripts/test-db.sh after every migration is
-- applied. Everything happens in one transaction that's rolled back.

begin;

create schema shares_test;
grant usage on schema shares_test to authenticated;

create table shares_test.people (name text primary key, id uuid not null);
grant select on shares_test.people to authenticated;

create function shares_test.id(who text) returns uuid language sql stable as $$
  select id from shares_test.people where name = who;
$$;

create function shares_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function shares_test.refused(statement text, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema shares_test to authenticated;

-- "name:amount, ..." for a session's shares, by name.
create function shares_test.shares(p_session integer) returns text language sql as $$
  select coalesce(string_agg(p.name || ':' || s.amount::text, ', ' order by p.name), '')
  from public.dues_shares(2026, p_session) s
  join shares_test.people p on p.id = coalesce(s.user_id, s.guest_id);
$$;

create function shares_test.paid_amount(p_session integer, who text) returns numeric language sql as $$
  select paid_amount from public.dues_payments
  where season_year = 2026 and session = p_session and coalesce(user_id, guest_id) = shares_test.id(who);
$$;

delete from public.dues_history;
delete from public.dues_payments;
delete from public.session_dues;
delete from public.session_roster;
delete from public.player_profiles;

-- ---------------------------------------------------------------------------
-- Ann (captain), Bo and Cy are active; Di is in the sub pool; Ed was taken off
-- the team. Roster names: Gina is active, Gus joined as Bo, Gail was removed.
-- ---------------------------------------------------------------------------

insert into shares_test.people values
  ('ann', '00000000-0000-4000-8000-0000000000e1'),
  ('bo', '00000000-0000-4000-8000-0000000000e2'),
  ('cy', '00000000-0000-4000-8000-0000000000e3'),
  ('di', '00000000-0000-4000-8000-0000000000e4'),
  ('ed', '00000000-0000-4000-8000-0000000000e5');

insert into auth.users (id, email) select id, name || '@shares.test' from shares_test.people;
update public.users set role = case when id = shares_test.id('ann') then 'admin' else 'user' end, joined_team_at = now()
  where id in (select id from shares_test.people);
insert into public.player_profiles (user_id, display_name, status, removed)
select id, initcap(name), case when name = 'di' then 'sub_pool' else 'active' end, name = 'ed' from shares_test.people;

insert into public.team_guests (display_name, status, removed, linked_user_id) values
  ('Gina', 'active', false, null),
  ('Gus', 'active', false, shares_test.id('bo')),
  ('Gail', 'active', true, null);
insert into shares_test.people select lower(display_name), id from public.team_guests;

-- The roster lists the triggers above started for the current session aren't part of this.
delete from public.session_roster;

-- ---------------------------------------------------------------------------
-- Session 2: $721, no list of its own (today's statuses). Cy has a custom $40.
-- ---------------------------------------------------------------------------

insert into public.session_dues (season_year, session, total_fee) values (2026, 2, 721);
insert into public.dues_payments (season_year, session, user_id, guest_id, override_amount, paid, paid_date, paid_amount) values
  (2026, 2, shares_test.id('cy'), null, 40, false, null, null),
  (2026, 2, shares_test.id('ann'), null, null, true, '2026-10-02', null),
  (2026, 2, shares_test.id('bo'), null, null, true, '2026-10-03', 200),
  (2026, 2, shares_test.id('di'), null, null, true, '2026-10-04', null),
  (2026, 2, null, shares_test.id('gina'), null, true, '2026-10-05', null);
insert into public.dues_history (season_year, session, user_id, paid, paid_date, created_date) values
  (2026, 2, shares_test.id('ann'), true, '2026-09-30', '2026-09-30 12:00'),
  (2026, 2, shares_test.id('ann'), false, null, '2026-10-01 12:00'),
  (2026, 2, shares_test.id('ann'), true, '2026-10-02', '2026-10-02 12:00');

select shares_test.ok(shares_test.shares(2) = 'ann:227, bo:227, cy:40.00, gina:227',
  'today''s active players split the fee after custom amounts, rounded up (not the sub pool, a removed player, or roster names that joined or were removed)');

-- ---------------------------------------------------------------------------
-- Session 3: $100, with its own list. Ed is on it as active (taken off the team
-- later), Gina is off it, and Gus's entry doesn't count now that he's Bo.
-- ---------------------------------------------------------------------------

insert into public.session_dues (season_year, session, total_fee) values (2026, 3, 100);
insert into public.session_roster (season_year, session, user_id, guest_id, status) values
  (2026, 3, shares_test.id('ann'), null, 'active'),
  (2026, 3, shares_test.id('bo'), null, 'on_break'),
  (2026, 3, shares_test.id('cy'), null, 'active'),
  (2026, 3, shares_test.id('di'), null, 'active'),
  (2026, 3, shares_test.id('ed'), null, 'active'),
  (2026, 3, null, shares_test.id('gina'), 'off'),
  (2026, 3, null, shares_test.id('gus'), 'active');

select shares_test.ok(shares_test.shares(3) = 'ann:25, cy:25, di:25, ed:25', 'a session with its own list splits across that list');

-- Session 4 has a list but no fee; session 5's custom amounts cover more than the fee; session 6 is in cents.
insert into public.session_roster (season_year, session, user_id, status) values (2026, 4, shares_test.id('ann'), 'active');
insert into public.session_dues (season_year, session, total_fee) values (2026, 5, 50), (2026, 6, 100.30);
insert into public.dues_payments (season_year, session, user_id, override_amount) values
  (2026, 5, shares_test.id('ann'), 60),
  (2026, 6, shares_test.id('ann'), 0.30);
select shares_test.ok(shares_test.shares(4) = '', 'a session without a fee has no shares');
select shares_test.ok(shares_test.shares(5) = 'ann:60.00, bo:0, cy:0, gina:0', 'custom amounts over the fee leave nothing for the rest');
select shares_test.ok(shares_test.shares(6) = 'ann:0.30, bo:34, cy:34, gina:34', '$100.30 less a $0.30 custom amount is $100 across three: $34 each, rounded up');

-- ---------------------------------------------------------------------------
-- Locking in what earlier payments count as
-- ---------------------------------------------------------------------------

select shares_test.ok(public.dues_fill_paid_amounts() = 2, 'payments marked before amounts were recorded are filled in');
select shares_test.ok(shares_test.paid_amount(2, 'ann') = 227 and shares_test.paid_amount(2, 'gina') = 227,
  'with the share each one shows now, roster names included');
select shares_test.ok(shares_test.paid_amount(2, 'bo') = 200, 'an amount already recorded stays as it is');
select shares_test.ok(shares_test.paid_amount(2, 'di') is null, 'someone who paid but is not on the active roster has no amount to fill in');
select shares_test.ok(shares_test.paid_amount(2, 'cy') is null, 'someone who has not paid gets no amount');
select shares_test.ok(
  (select array_agg(paid_amount::text order by created_date) from public.dues_history where user_id = shares_test.id('ann')) = '{NULL,NULL,227.00}',
  'their latest paid entry in the history gets the same amount; earlier entries stay as they were');
select shares_test.ok(public.dues_fill_paid_amounts() = 0, 'filling in again changes nothing');

-- ---------------------------------------------------------------------------
-- The version of mark_dues_paid() without amounts (a site that hasn't reloaded)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', shares_test.id('bo')::text, false);
set role authenticated;
select public.mark_dues_paid(2026, 2, array[shares_test.id('cy')], true, '2026-10-09');
select shares_test.ok(shares_test.paid_amount(2, 'cy') = 40, 'records the share the database works out');
select public.mark_dues_paid(2026, 3, array[shares_test.id('ed'), shares_test.id('gina')], true, '2026-10-09');
select shares_test.ok(shares_test.paid_amount(3, 'ed') = 25 and shares_test.paid_amount(3, 'gina') is null,
  'and no amount for someone off the session''s roster');
select shares_test.refused($$select * from public.dues_shares(2026, 2)$$, 'players cannot call dues_shares() directly');
select shares_test.refused($$select public.dues_fill_paid_amounts()$$, 'players cannot fill in amounts');
reset role;

rollback;
