begin;
create schema username_test;
grant usage on schema username_test to authenticated, anon, service_role;
create function username_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end;
$$;
create function username_test.refused(statement text, what text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then raise notice 'ok - %', what; return; end;
  raise exception 'FAILED: % (allowed)', what;
end;
$$;
grant execute on all functions in schema username_test to authenticated, anon, service_role;

insert into auth.users(id, email) values
  ('99999999-1111-4111-8111-111111111111', 'one@username.test'),
  ('99999999-2222-4222-8222-222222222222', 'two@username.test'),
  ('99999999-3333-4333-8333-333333333333', '1f0c2d9e@players.jiveturkeys.invalid');
select username_test.ok((select email is null from public.users where id = '99999999-3333-4333-8333-333333333333'),
  'an email-free account''s internal address stays out of public.users');
select username_test.ok((select email = 'one@username.test' from public.users where id = '99999999-1111-4111-8111-111111111111'),
  'real addresses are still copied');
update public.users set joined_team_at = now() where email like '%@username.test';
insert into public.username_accounts(user_id, username, recovery_hash) values
  ('99999999-1111-4111-8111-111111111111', 'player_one', repeat('a', 64)),
  ('99999999-2222-4222-8222-222222222222', 'player_two', repeat('b', 64));

set local role anon;
select username_test.refused('select username from public.username_accounts', 'signed-out visitors cannot list usernames');
select username_test.refused('select public.username_auth_attempt(''key'', 10)', 'visitors cannot bypass or reset limits');
select username_test.refused('select public.claim_username_recovery(''player_one'', repeat(''a'',64), repeat(''c'',64))', 'visitors cannot claim recovery directly');
select username_test.refused('select public.team_code_matches(''TURKEY'')', 'visitors cannot test team codes directly');
select username_test.refused('select public.replace_username_recovery(''99999999-1111-4111-8111-111111111111'', repeat(''a'',64), repeat(''c'',64))', 'visitors cannot replace recovery codes');
select username_test.refused('select public.join_team_as(''99999999-3333-4333-8333-333333333333'', ''TURKEY'')', 'visitors cannot join an account to the team');
reset role;
select set_config('request.jwt.claim.sub', '99999999-1111-4111-8111-111111111111', true);
set local role authenticated;
select username_test.ok((select count(user_id) = 1 from public.username_accounts), 'players see only their own alias');
select username_test.ok((select username = 'player_one' from public.username_accounts), 'players can read their username');
select username_test.refused('select recovery_hash from public.username_accounts', 'players cannot read even their own recovery hash');
select username_test.refused('update public.username_accounts set username = ''stolen''', 'players cannot change aliases directly');
select username_test.refused('select * from public.username_auth_limits', 'players cannot read rate limit records');
select username_test.refused('select public.username_auth_attempt(''key'', 10)', 'players cannot call the service-only counter');
select username_test.refused('select public.claim_username_recovery(''player_one'', repeat(''a'',64), repeat(''c'',64))', 'players cannot bypass account service recovery');
select username_test.refused('select public.team_code_matches(''TURKEY'')', 'players cannot test team codes without the join_team() limit');
select username_test.refused('select public.replace_username_recovery(''99999999-1111-4111-8111-111111111111'', repeat(''a'',64), repeat(''c'',64))', 'players cannot replace codes without the password check');
select username_test.refused('select reset_at from public.username_accounts', 'players cannot read reset times');
select username_test.refused('select public.join_team_as(''99999999-3333-4333-8333-333333333333'', ''TURKEY'')', 'players cannot join someone else to the team');
reset role;

set local role service_role;
select username_test.ok(public.username_auth_attempt('test-key', 2), 'the first try is allowed');
select username_test.ok(public.username_auth_attempt('test-key', 2), 'the second try is allowed');
select username_test.ok(not public.username_auth_attempt('test-key', 2), 'the third try is blocked');
update public.username_auth_limits set window_start = now() - interval '16 minutes' where key = 'test-key';
select username_test.ok(public.username_auth_attempt('test-key', 2), 'an expired window starts over');
select username_test.ok((select attempts = 1 from public.username_auth_limits where key = 'test-key'), 'the expired count resets');
update public.username_auth_limits set window_start = now() - interval '16 minutes' where key = 'test-key';
create temp table limit_rows on commit drop as select count(*) as n from public.username_auth_limits;
select username_test.ok(public.username_auth_attempt('brand-new-key', 2), 'a new key is counted');
select username_test.ok((select count(*) from public.username_auth_limits) = (select n from limit_rows),
  'a new key takes over a finished window instead of adding a row');
select username_test.ok((select attempts = 1 from public.username_auth_limits where key = 'brand-new-key'), 'and starts its own count');
select username_test.ok(public.username_auth_attempt('brand-new-key', 2), 'its second try is allowed');
select username_test.ok(not public.username_auth_attempt('brand-new-key', 2), 'its third try is blocked');
select username_test.ok(public.username_auth_attempt('another-key', 2), 'with no finished window, a new key adds a row');
select username_test.ok((select count(*) from public.username_auth_limits) = (select n from limit_rows) + 1, 'one more row');
select username_test.ok(public.claim_username_recovery('player_one', repeat('b',64), repeat('c',64)) is null, 'a wrong recovery hash cannot claim an account');
select username_test.ok(public.claim_username_recovery('player_one', repeat('a',64), repeat('c',64)) = '99999999-1111-4111-8111-111111111111'::uuid, 'a matching claim returns the same identity');
select username_test.ok(public.claim_username_recovery('player_one', repeat('a',64), repeat('d',64)) is null, 'a used code cannot win a second claim');
select username_test.ok(public.claim_username_recovery('player_one', repeat('c',64), repeat('d',64)) is not null, 'the replacement recovery code works');
select username_test.ok((select reset_at > now() - interval '1 minute' from public.username_accounts where username = 'player_one'), 'a reset is recorded');
select username_test.ok(not public.replace_username_recovery('99999999-1111-4111-8111-111111111111', repeat('d',64), repeat('e',64)),
  'the code cannot be replaced right after a reset');
update public.username_accounts set reset_at = now() - interval '11 minutes' where username = 'player_one';
select username_test.ok(not public.replace_username_recovery('99999999-1111-4111-8111-111111111111', repeat('c',64), repeat('e',64)),
  'a replacement based on a code that has since changed is refused');
select username_test.ok(not public.replace_username_recovery('99999999-2222-4222-8222-222222222222', repeat('d',64), repeat('e',64)),
  'a replacement only touches its own account');
select username_test.ok(public.replace_username_recovery('99999999-1111-4111-8111-111111111111', repeat('d',64), repeat('e',64)),
  '10 minutes after a reset, the current code can be replaced');
select username_test.ok((select recovery_hash = repeat('e',64) from public.username_accounts where username = 'player_one'), 'and the new one is stored');
select username_test.ok((select recovery_hash = repeat('b',64) from public.username_accounts where username = 'player_two'), 'the other account is untouched');
select username_test.ok(public.team_code_matches(' ' || lower((select code from public.team_join_code)) || ' '), 'the team code matches in any case, spaces ignored');
select username_test.ok(not public.team_code_matches('not-the-code'), 'another code does not');
select username_test.ok(public.join_team_as('99999999-3333-4333-8333-333333333333', 'not-the-code') = 'wrong', 'joining with a wrong code is turned away');
select username_test.ok((select joined_team_at is null and join_tries = 1 from public.users where id = '99999999-3333-4333-8333-333333333333'),
  'and counts toward the same ten-try block as join_team()');
select username_test.ok(public.join_team_as('99999999-3333-4333-8333-333333333333', (select code from public.team_join_code)) = 'joined', 'the right code joins the account');
select username_test.ok((select joined_team_at is not null and join_tries = 0 from public.users where id = '99999999-3333-4333-8333-333333333333'), 'it is on the team');
reset role;

select username_test.refused($q$insert into public.username_accounts(user_id, username, recovery_hash)
  values ('99999999-1111-4111-8111-111111111111', 'duplicate', repeat('a',64))$q$, 'one alias per identity');
select username_test.refused($q$update public.username_accounts set username = 'player_one' where username = 'player_two'$q$, 'usernames are unique');
select username_test.refused($q$update public.username_accounts set username = 'UPPERCASE' where username = 'player_two'$q$, 'stored usernames are canonical');
rollback;
