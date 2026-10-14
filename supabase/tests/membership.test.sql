-- Team code database tests: a signed-in account that hasn't entered the team
-- code sees and changes nothing; the right code lets it in; too many wrong
-- codes block it for an hour; captains change the code. Run by
-- scripts/test-db.sh after every migration is applied. Everything happens in
-- one transaction that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema join_test;
grant usage on schema join_test to authenticated, anon;

create table join_test.people (name text primary key, id uuid not null);
grant select on join_test.people to authenticated, anon;

create function join_test.id(who text) returns uuid language sql stable as $$
  select id from join_test.people where name = who;
$$;

create function join_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function join_test.refused(statement text, what text) returns void language plpgsql as $$
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

-- Rows of each team table the signed-in account can see, as "table:count" (zero counts left out).
create function join_test.visible() returns text language plpgsql as $$
declare
  t text;
  n integer;
  seen text[] := '{}';
begin
  foreach t in array array[
    'player_profiles', 'team_settings', 'games', 'rsvps', 'game_stats', 'game_fill_ins', 'potm_votes', 'session_dues',
    'dues_payments', 'dues_history', 'team_guests', 'session_roster', 'messages', 'chat_threads',
    'message_reactions', 'announcements', 'team_join_code'
  ] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      seen := seen || format('%s:%s', t, n);
    end if;
  end loop;
  return array_to_string(seen, ', ');
end;
$$;

grant execute on all functions in schema join_test to authenticated, anon;

create function join_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', join_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cap set up the team (the first account), Ann joined with the code, and Zed
-- just signed up.
-- ---------------------------------------------------------------------------

-- chat.test.sql runs first and leaves its team (and its last signed-in player)
-- behind: start signed out, with an empty team (all rolled back at the end),
-- so Cap really is the first account.
reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from public.dues_history;
delete from public.dues_payments;
delete from public.session_roster;
delete from public.team_guests;
delete from public.session_dues;
delete from public.games;
delete from public.messages;
delete from public.chat_threads;
delete from public.announcements;
delete from auth.users;

insert into join_test.people values
  ('cap', '00000000-0000-4000-8000-0000000000f1'),
  ('ann', '00000000-0000-4000-8000-0000000000f2'),
  ('zed', '00000000-0000-4000-8000-0000000000f3'),
  ('yan', '00000000-0000-4000-8000-0000000000f4');

insert into auth.users (id, email) values (join_test.id('cap'), 'cap@join.test');
insert into auth.users (id, email) select id, name || '@join.test' from join_test.people where name <> 'cap';

select join_test.ok(
  (select role = 'admin' and joined_team_at is not null from public.users where id = join_test.id('cap')),
  'the first account is a captain and on the team');
select join_test.ok(
  (select count(*) = 3 from public.users where joined_team_at is null and id in (select id from join_test.people)),
  'later sign-ups are not on the team yet');
select join_test.ok((select count(*) = 1 from public.team_join_code), 'there is one team code');
select join_test.ok((select code ~ '^[A-Z2-9]{6}$' from public.team_join_code), 'it starts as six random letters and numbers');

update public.users set joined_team_at = now() where id = join_test.id('ann');
insert into public.player_profiles (user_id, display_name, gender, status) values
  (join_test.id('cap'), 'Cap', 'F', 'active'),
  (join_test.id('ann'), 'Ann', 'F', 'active');
insert into public.games (id, season_year, session, date, opponent)
  values ('00000000-0000-4000-8000-00000000f0a1', 2026, 1, current_date + 3, 'Net Ninjas');
insert into public.rsvps (game_id, user_id, status) values ('00000000-0000-4000-8000-00000000f0a1', join_test.id('ann'), 'in');
insert into public.game_fill_ins (game_id, gender, goals) values ('00000000-0000-4000-8000-00000000f0a1', 'M', 1);
insert into public.team_guests (id, display_name, status) values ('00000000-0000-4000-8000-00000000f0b1', 'Gus', 'active');
insert into public.session_dues (season_year, session, total_fee) values (2026, 1, 700);
insert into public.messages (user_id, author_name, body) values (join_test.id('ann'), 'Ann', 'Ann''s number is in the roster');
insert into public.announcements (title, body) values ('Welcome', 'Season starts soon');
update public.team_join_code set code = 'TURKEY42';

-- ---------------------------------------------------------------------------
-- Zed hasn't entered the code.
-- ---------------------------------------------------------------------------

select join_test.sign_in('zed');
select join_test.ok(join_test.visible() = '', 'an account that hasn''t joined sees no team data at all, the code included');
select join_test.ok((select count(*) = 1 from public.users where id = auth.uid()), 'but can see their own account');
select join_test.refused(
  $$insert into public.player_profiles (user_id, display_name, gender) values (auth.uid(), 'Zed', 'M')$$,
  'cannot add themselves to the roster');
select join_test.refused(
  $$insert into public.rsvps (game_id, user_id, status) values ('00000000-0000-4000-8000-00000000f0a1', auth.uid(), 'in')$$,
  'cannot RSVP');
select join_test.refused($$insert into public.messages (user_id, author_name, body) values (auth.uid(), 'Zed', 'hi')$$,
  'cannot post in the chat');
select join_test.refused($$insert into public.chat_threads (title, created_by) values ('Hi', auth.uid())$$, 'cannot start a thread');
select join_test.refused(
  $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://push.test/zed', 'k', 'a')$$,
  'cannot sign a phone up for chat notifications');
select public.push_subscribe('https://push.test/zed2', 'k', 'a', 'Phone');
select join_test.refused($$select public.mark_dues_paid(2026, 1, array[join_test.id('ann')], true, null)$$, 'cannot mark anyone paid');
select join_test.refused($$select public.set_dues_partner(join_test.id('ann'), join_test.id('cap'))$$, 'cannot link a couple');
select join_test.refused($$select public.claim_team_guest('00000000-0000-4000-8000-00000000f0b1')$$, 'cannot pick a name on the roster');
select join_test.refused($$select public.roster_start_current()$$, 'cannot start a session');
update public.team_join_code set code = 'MINE1234';
reset role;
select join_test.ok(not exists (select 1 from public.push_subscriptions where user_id = join_test.id('zed')),
  'signing a phone up through the site did nothing');
select join_test.ok((select code = 'TURKEY42' from public.team_join_code), 'and trying to change the code did nothing');

-- Wrong codes, then too many.
select join_test.sign_in('zed');
select join_test.ok(public.join_team('TURKEY') = 'wrong', 'a wrong code is turned away');
select join_test.ok(join_test.visible() = '', 'and still shows nothing');
select public.join_team('guess' || n) from generate_series(2, 9) n;
select join_test.ok(public.join_team('guess10') = 'blocked', 'ten wrong codes in a row block more tries');
select join_test.ok(public.join_team('TURKEY42') = 'blocked', 'even the right code, for now');
reset role;
select join_test.ok(
  (select joined_team_at is null and join_blocked_until > now() + interval '59 minutes' from public.users where id = join_test.id('zed')),
  'for an hour');
update public.users set join_blocked_until = now() - interval '1 minute' where id = join_test.id('zed');

select join_test.sign_in('zed');
select join_test.ok(public.join_team('  turkey42 ') = 'joined', 'once the hour is up, the right code lets them in (any case, spaces ignored)');
select join_test.ok(
  join_test.visible() like '%player_profiles:2%' and join_test.visible() like '%messages:1%' and join_test.visible() like '%team_join_code:1%',
  'and they see the team, the code included');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Zed', 'M', 'active');
select join_test.ok(public.join_team('anything') = 'joined', 'joining again changes nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Captains change the code; members read it but can't change it.
-- ---------------------------------------------------------------------------

select join_test.sign_in('ann');
select join_test.ok((select code = 'TURKEY42' from public.team_join_code), 'members can read the code (for Copy invite)');
update public.team_join_code set code = 'ANNSCODE';
select join_test.ok((select code = 'TURKEY42' from public.team_join_code), 'members cannot change it');
reset role;

select join_test.sign_in('cap');
update public.team_join_code set code = 'SESSION2', updated_by = auth.uid();
select join_test.ok((select code = 'SESSION2' from public.team_join_code), 'a captain changes the code');
select join_test.refused($$update public.team_join_code set code = 'abc'$$, 'a code is at least 4 characters');
select join_test.refused($$insert into public.team_join_code (code) values ('SECOND')$$, 'there is only ever one code');
reset role;

select join_test.sign_in('yan');
select join_test.ok(public.join_team('TURKEY42') = 'wrong', 'an old code stops working once it changes');
select join_test.ok(public.join_team('session2') = 'joined', 'the new one works');
reset role;
select join_test.sign_in('ann');
select join_test.ok(join_test.visible() like '%messages:1%', 'players already on the team stay on it after a change');
reset role;

-- ---------------------------------------------------------------------------
-- Captains take a signed-up player off the team, and add them back.
-- ---------------------------------------------------------------------------

select join_test.sign_in('ann');
select join_test.refused($$select public.set_team_member_removed(join_test.id('cap'), true)$$, 'players cannot remove anyone');
reset role;

select join_test.sign_in('cap');
select join_test.refused($$select public.set_team_member_removed(join_test.id('cap'), true)$$, 'captains cannot remove themselves');
select public.push_subscribe('https://push.test/ann', 'k', 'a', 'Phone');
reset role;
update public.push_subscriptions set user_id = join_test.id('ann') where endpoint = 'https://push.test/ann';
select join_test.sign_in('cap');
select public.set_team_member_removed(join_test.id('ann'), true);
select join_test.ok(
  (select status = 'off' from public.session_roster r, public.roster_current_session() c
    where r.user_id = join_test.id('ann') and r.season_year = c.cur_year and r.session = c.cur_session),
  'a removed player is off the current session''s list');
reset role;

select join_test.sign_in('ann');
select join_test.ok(join_test.visible() = '', 'a removed player sees no team data');
select join_test.refused($$insert into public.messages (user_id, author_name, body) values (auth.uid(), 'Ann', 'hi')$$,
  'a removed player cannot post in the chat');
select join_test.ok(public.join_team('SESSION2') = 'removed', 'the team code does not let a removed player back in');
reset role;
select join_test.ok(
  (select joined_team_at is null and removed_at is not null from public.users where id = join_test.id('ann')),
  'and they are still off the team');
select join_test.ok(exists (select 1 from public.messages where user_id = join_test.id('ann')), 'their chat messages stay');
select join_test.ok(exists (select 1 from public.rsvps where user_id = join_test.id('ann')), 'their sign-ups stay');
insert into public.messages (id, user_id, author_name, body)
  values ('00000000-0000-4000-8000-00000000f0c1', join_test.id('cap'), 'Cap', 'After Ann left');
select join_test.ok(
  not exists (select 1 from public.chat_push_targets('00000000-0000-4000-8000-00000000f0c1') where endpoint = 'https://push.test/ann'),
  'a removed player''s phone gets no chat notifications');

select join_test.sign_in('cap');
select public.set_team_member_removed(join_test.id('ann'), false);
reset role;
select join_test.sign_in('ann');
select join_test.ok(join_test.visible() like '%messages:%', 'added back, they see the team again');
select join_test.ok(
  (select status = 'active' and not removed from public.player_profiles where user_id = auth.uid()),
  'as Active');
reset role;

set role anon;
select join_test.refused($$select public.join_team('SESSION2')$$, 'signed-out visitors cannot try a code');
select join_test.refused($$select count(*) from public.team_join_code$$, 'signed-out visitors cannot see the code');
reset role;

rollback;
