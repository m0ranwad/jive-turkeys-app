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

-- ---------------------------------------------------------------------------
-- Teammates who aren't on the app
-- ---------------------------------------------------------------------------

create function dues_test.guest(who text) returns uuid language sql stable as $$
  select id from public.team_guests where display_name = who;
$$;
grant execute on function dues_test.guest(text) to authenticated;

select dues_test.sign_in('dana');
select dues_test.refused($$insert into public.team_guests (display_name) values ('Sneaky Pete')$$,
  'a player cannot add someone who is not on the app');
reset role;

select dues_test.sign_in('kim');
select dues_test.touches($$insert into public.team_guests (display_name, gender, created_by) values ('Mike Russo', 'M', dues_test.id('kim')), ('Pat Lee', 'F', dues_test.id('kim'))$$, 2,
  'a captain can add teammates who are not on the app');
select dues_test.ok((select status = 'active' and not removed from public.team_guests where display_name = 'Pat Lee'), 'they start out active on the team');
select dues_test.refused($$insert into public.team_guests (display_name) values ('   ')$$, 'a guest needs a name');
select dues_test.refused($$update public.team_guests set status = 'retired' where display_name = 'Pat Lee'$$, 'a guest has the usual roster statuses');
select dues_test.touches($$update public.team_guests set status = 'sub_pool' where display_name = 'Pat Lee'$$, 1,
  'a captain can change a guest''s roster status');
select dues_test.touches($$insert into public.dues_payments (season_year, session, guest_id, override_amount) values (2026, 2, dues_test.guest('Pat Lee'), 30)$$, 1,
  'a captain can give a guest a custom amount');
select dues_test.refused($$insert into public.dues_payments (season_year, session, override_amount) values (2026, 2, 30)$$,
  'a payment belongs to a player');
select dues_test.refused($$insert into public.dues_payments (season_year, session, user_id, guest_id) values (2026, 3, dues_test.id('kim'), dues_test.guest('Pat Lee'))$$,
  'a payment belongs to only one player');
reset role;

select dues_test.sign_in('dana');
select dues_test.ok((select count(*) from public.team_guests) = 2, 'players can see teammates who are not on the app');
select public.mark_dues_paid(2026, 2, array[dues_test.guest('Mike Russo')], true, '2026-10-09');
select dues_test.ok(
  (select paid and paid_date = '2026-10-09' and paid_by = dues_test.id('dana') and user_id is null
   from public.dues_payments where guest_id = dues_test.guest('Mike Russo')),
  'a player can mark a guest paid');
select dues_test.ok(
  exists (select 1 from public.dues_history where guest_id = dues_test.guest('Mike Russo') and paid and changed_by = dues_test.id('dana')),
  'marking a guest paid goes in the history');
select dues_test.touches($$update public.team_guests set display_name = 'Renamed'$$, 0, 'a player cannot rename a guest');
select dues_test.touches($$update public.team_guests set status = 'on_break'$$, 0, 'a player cannot change a guest''s status');
select public.set_dues_partner(dues_test.id('dot'), dues_test.guest('Mike Russo'));
select dues_test.ok(
  dues_test.partner('dot') is null
  and (select pays_with_guest from public.player_profiles where user_id = dues_test.id('dot')) = dues_test.guest('Mike Russo')
  and (select pays_with_user from public.team_guests where display_name = 'Mike Russo') = dues_test.id('dot'),
  'an app player and a guest can pay together');
select dues_test.refused($$select public.link_team_guest(dues_test.guest('Mike Russo'), dues_test.id('sub'))$$,
  'a player cannot link a guest to an account');
reset role;

select dues_test.sign_in('kim');
select dues_test.touches($$delete from public.team_guests$$, 0, 'nobody can delete a guest, captains included');
select public.link_team_guest(dues_test.guest('Mike Russo'), dues_test.id('sub'));
select dues_test.ok(
  (select paid and guest_id is null from public.dues_payments where user_id = dues_test.id('sub') and session = 2)
  and not exists (select 1 from public.dues_history where guest_id = dues_test.guest('Mike Russo'))
  and exists (select 1 from public.dues_history where user_id = dues_test.id('sub') and paid and changed_by = dues_test.id('dana')),
  'linking a guest to their account moves their payments and history');
select dues_test.ok(
  (select linked_user_id = dues_test.id('sub') from public.team_guests where display_name = 'Mike Russo')
  and dues_test.partner('sub') = dues_test.id('dot') and dues_test.partner('dot') = dues_test.id('sub'),
  'the guest is kept, marked as linked, and their partner moves with them');
select dues_test.refused($$select public.link_team_guest(dues_test.guest('Mike Russo'), dues_test.id('dana'))$$,
  'a guest can only be linked once');
reset role;

-- ---------------------------------------------------------------------------
-- A new player picks their name on the roster
-- ---------------------------------------------------------------------------

insert into dues_test.people values ('newbie', '00000000-0000-4000-8000-0000000000d6');
insert into auth.users (id, email) values (dues_test.id('newbie'), 'newbie@dues.test');
insert into public.player_profiles (user_id, display_name) values (dues_test.id('newbie'), 'Rosa');

select dues_test.sign_in('kim');
insert into public.team_guests (display_name, gender, position, status) values ('Rosa Diaz', 'F', 'Goalie', 'sub_pool');
select public.mark_dues_paid(2026, 2, array[dues_test.guest('Rosa Diaz')], true, '2026-10-05');
reset role;

select dues_test.sign_in('newbie');
select dues_test.refused($$select public.move_team_guest(dues_test.guest('Rosa Diaz'), dues_test.id('newbie'))$$,
  'players cannot use the move step directly');
select public.claim_team_guest(dues_test.guest('Rosa Diaz'));
select dues_test.ok(
  (select status = 'sub_pool' and gender = 'F' and position = 'Goalie' from public.player_profiles where user_id = dues_test.id('newbie')),
  'picking your name brings over your roster status and details');
select dues_test.ok(
  (select paid and paid_date = '2026-10-05' and guest_id is null from public.dues_payments where user_id = dues_test.id('newbie') and session = 2)
  and (select linked_user_id = dues_test.id('newbie') from public.team_guests where display_name = 'Rosa Diaz'),
  'and your dues payment moves to your account');
select dues_test.refused($$select public.claim_team_guest(dues_test.guest('Pat Lee'))$$, 'you can only pick one name');
reset role;

select dues_test.sign_in('dana');
select dues_test.refused($$select public.claim_team_guest(dues_test.guest('Rosa Diaz'))$$, 'nobody else can pick a name that is taken');
reset role;
select dues_test.sign_in('kim');
update public.team_guests set removed = true where display_name = 'Pat Lee';
reset role;
select dues_test.sign_in('dana');
select dues_test.refused($$select public.claim_team_guest(dues_test.guest('Pat Lee'))$$, 'a name taken off the roster cannot be picked');
reset role;

-- Someone who joined without picking their name, was marked separately, and
-- is then linked: nothing either of them had is lost.
insert into dues_test.people values ('late', '00000000-0000-4000-8000-0000000000d7');
insert into auth.users (id, email) values (dues_test.id('late'), 'late@dues.test');
insert into public.player_profiles (user_id, display_name, status) values (dues_test.id('late'), 'Lou', 'active');

select dues_test.sign_in('kim');
insert into public.team_guests (display_name) values ('Lou Late');
insert into public.dues_payments (season_year, session, guest_id, override_amount, paid, paid_date, paid_by) values
  (2026, 2, dues_test.guest('Lou Late'), null, true, '2026-10-01', dues_test.id('kim')),
  (2026, 3, dues_test.guest('Lou Late'), 25, false, null, null),
  (2026, 4, dues_test.guest('Lou Late'), null, true, '2026-10-02', dues_test.id('kim')),
  (2026, 5, dues_test.guest('Lou Late'), null, true, '2026-10-04', dues_test.id('kim'));
insert into public.dues_payments (season_year, session, user_id, override_amount, paid, paid_date, paid_by) values
  (2026, 2, dues_test.id('late'), 50, false, null, null),
  (2026, 3, dues_test.id('late'), null, false, null, null),
  (2026, 5, dues_test.id('late'), null, true, '2026-09-30', dues_test.id('dana'));
select public.link_team_guest(dues_test.guest('Lou Late'), dues_test.id('late'));
select dues_test.ok(
  (select paid and paid_date = '2026-10-01' and paid_by = dues_test.id('kim') and override_amount = 50
   from public.dues_payments where user_id = dues_test.id('late') and session = 2),
  'linking: a payment made under the roster name counts, and the account''s custom amount stays');
select dues_test.ok(
  (select not paid and override_amount = 25 from public.dues_payments where user_id = dues_test.id('late') and session = 3),
  'linking: a custom amount set under the roster name carries over');
select dues_test.ok(
  (select paid and paid_date = '2026-10-02' and guest_id is null from public.dues_payments where user_id = dues_test.id('late') and session = 4),
  'linking: a session only the roster name had moves over');
select dues_test.ok(
  (select paid and paid_date = '2026-09-30' and paid_by = dues_test.id('dana') from public.dues_payments where user_id = dues_test.id('late') and session = 5),
  'linking: a payment the account already had stays as it was');
select dues_test.ok(
  (select count(*) = 3 from public.dues_payments where guest_id = dues_test.guest('Lou Late'))
  and (select count(*) = 4 from public.dues_payments where user_id = dues_test.id('late')),
  'linking: the roster name''s own rows are kept, not deleted');
reset role;

set role anon;
select dues_test.refused($$select public.mark_dues_paid(2026, 2, array[dues_test.id('dana')], true, null)$$,
  'signed-out visitors cannot mark anyone paid');
select dues_test.refused($$select public.set_dues_partner(dues_test.id('dana'), dues_test.id('dex'))$$,
  'signed-out visitors cannot link players');
select dues_test.refused($$select count(*) from public.dues_payments$$, 'signed-out visitors cannot see who has paid');
select dues_test.refused($$select count(*) from public.team_guests$$, 'signed-out visitors cannot see guests');
select dues_test.refused($$select public.link_team_guest(gen_random_uuid(), gen_random_uuid())$$, 'signed-out visitors cannot link guests');
select dues_test.refused($$select public.claim_team_guest(gen_random_uuid())$$, 'signed-out visitors cannot pick a name');
reset role;

rollback;
