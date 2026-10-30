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
  ('99999999-2222-4222-8222-222222222222', 'two@username.test');
update public.users set joined_team_at = now() where email like '%@username.test';
insert into public.username_accounts(user_id, username, recovery_hash) values
  ('99999999-1111-4111-8111-111111111111', 'player_one', repeat('a', 64)),
  ('99999999-2222-4222-8222-222222222222', 'player_two', repeat('b', 64));

set local role anon;
select username_test.refused('select username from public.username_accounts', 'signed-out visitors cannot list usernames');
select username_test.refused('select public.username_auth_attempt(''key'', 10)', 'visitors cannot bypass or reset limits');
select username_test.refused('select public.claim_username_recovery(''player_one'', repeat(''a'',64), repeat(''c'',64))', 'visitors cannot claim recovery directly');
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
reset role;

set local role service_role;
select username_test.ok(public.username_auth_attempt('test-key', 2), 'the first try is allowed');
select username_test.ok(public.username_auth_attempt('test-key', 2), 'the second try is allowed');
select username_test.ok(not public.username_auth_attempt('test-key', 2), 'the third try is blocked');
update public.username_auth_limits set window_start = now() - interval '16 minutes' where key = 'test-key';
select username_test.ok(public.username_auth_attempt('test-key', 2), 'an expired window starts over');
select username_test.ok((select attempts = 1 from public.username_auth_limits where key = 'test-key'), 'the expired count resets');
select username_test.ok(public.claim_username_recovery('player_one', repeat('b',64), repeat('c',64)) is null, 'a wrong recovery hash cannot claim an account');
select username_test.ok(public.claim_username_recovery('player_one', repeat('a',64), repeat('c',64)) = '99999999-1111-4111-8111-111111111111'::uuid, 'a matching claim returns the same identity');
select username_test.ok(public.claim_username_recovery('player_one', repeat('a',64), repeat('d',64)) is null, 'a used code cannot win a second claim');
select username_test.ok(public.claim_username_recovery('player_one', repeat('c',64), repeat('d',64)) is not null, 'the replacement recovery code works');
reset role;

select username_test.refused($q$insert into public.username_accounts(user_id, username, recovery_hash)
  values ('99999999-1111-4111-8111-111111111111', 'duplicate', repeat('a',64))$q$, 'one alias per identity');
select username_test.refused($q$update public.username_accounts set username = 'player_one' where username = 'player_two'$q$, 'usernames are unique');
select username_test.refused($q$update public.username_accounts set username = 'UPPERCASE' where username = 'player_two'$q$, 'stored usernames are canonical');
rollback;
