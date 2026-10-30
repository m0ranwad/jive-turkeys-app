begin;
create schema reset_test;
grant usage on schema reset_test to anon, authenticated, service_role;
create function reset_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end;
$$;
create function reset_test.refused(statement text, what text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then raise notice 'ok - %', what; return; end;
  raise exception 'FAILED: % (allowed)', what;
end;
$$;

-- Auth validates the password first, then writes the encrypted password and
-- app_metadata in separate statements in one transaction (password first).
-- Force the deferred trigger here so each assertion sees the commit outcome.
create function reset_test.write_password(p_user uuid, p_password text, p_claim uuid default null)
returns void language plpgsql as $$
begin
  update auth.users set encrypted_password = p_password where id = p_user;
  if p_claim is not null then
    update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('jt_username_reset_claim', p_claim::text) where id = p_user;
  end if;
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

insert into auth.users(id, email, encrypted_password, raw_app_meta_data) values
  ('88888888-1111-4111-8111-111111111111', 'captain@reset.test', 'captain-hash', '{"providers":["email"]}'),
  ('88888888-2222-4222-8222-222222222222', 'player@reset.test', 'old-hash', '{"providers":["email"],"other":"kept"}'),
  ('88888888-3333-4333-8333-333333333333', 'ordinary@reset.test', 'ordinary-hash', '{"providers":["google"]}');
update public.users set role = case when id = '88888888-1111-4111-8111-111111111111' then 'admin' else 'user' end,
  joined_team_at = now() where email like '%@reset.test';
insert into public.username_accounts(user_id, username)
  values ('88888888-2222-4222-8222-222222222222', 'reset_player');

set local role anon;
select reset_test.refused($q$select public.username_reset_claim('reset_player', repeat('a',64), gen_random_uuid())$q$,
  'visitors cannot claim a reset');
select reset_test.refused($q$select public.username_reset_issue(null, null, repeat('a',64), now())$q$,
  'visitors cannot issue reset codes');
select reset_test.refused($q$select public.username_reset_release(null, null)$q$,
  'visitors cannot release a claim');
reset role;

select set_config('request.jwt.claim.sub', '88888888-2222-4222-8222-222222222222', true);
set local role authenticated;
select reset_test.refused('select reset_claim_id, reset_claimed_at from public.username_accounts',
  'players cannot read private reset coordination fields');
select reset_test.refused($q$select public.username_reset_claim('reset_player', repeat('a',64), gen_random_uuid())$q$,
  'players cannot call the service-only claim function');
select reset_test.refused($q$select public.username_reset_issue(null, null, repeat('a',64), now())$q$,
  'players cannot call the service-only issue function');
select reset_test.refused('select public.username_reset_release(null, null)',
  'players cannot release another reset');
reset role;
select set_config('request.jwt.claim.sub', '88888888-1111-4111-8111-111111111111', true);
set local role authenticated;
select reset_test.refused('select reset_claim_id from public.username_accounts',
  'captains also cannot read private reset claims');
reset role;

set local role service_role;
select reset_test.ok(public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-2222-4222-8222-222222222222', repeat('a',64), now()+interval '1 day') = 'forbidden',
  'issuing a code rechecks that its maker is a captain');
select reset_test.ok(public.username_reset_issue('88888888-3333-4333-8333-333333333333',
  '88888888-1111-4111-8111-111111111111', repeat('a',64), now()+interval '1 day') = 'missing',
  'only accounts with a username have reset codes');
select reset_test.ok(public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-1111-4111-8111-111111111111', repeat('b',64), now()+interval '1 day') = 'issued', 'a captain makes a code');
select reset_test.ok(public.username_reset_claim('reset_player', repeat('x',64), gen_random_uuid()) is null,
  'a wrong hash does not claim the code');
select reset_test.ok(public.username_reset_claim('reset_player', repeat('b',64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  = '88888888-2222-4222-8222-222222222222', 'one reset claims the code');
select reset_test.ok(public.username_reset_claim('reset_player', repeat('b',64), gen_random_uuid()) is null,
  'another reset cannot claim it concurrently');
select reset_test.ok(public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-1111-4111-8111-111111111111', repeat('c',64), now()+interval '1 day') = 'busy',
  'a captain is asked to retry while the reset is finishing');
select reset_test.ok((select reset_hash = repeat('b',64) from public.username_accounts where username = 'reset_player'),
  'the busy response leaves the existing code intact');
reset role;

select reset_test.refused($q$select reset_test.write_password('88888888-2222-4222-8222-222222222222', 'bypass-hash')$q$,
  'a password update cannot bypass a reset claim by omitting its marker');
select reset_test.ok((select encrypted_password = 'old-hash' from auth.users where email = 'player@reset.test'),
  'a rejected write does not change the password');
select public.username_reset_release('88888888-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select reset_test.ok((select reset_hash = repeat('b',64) and reset_claim_id is null from public.username_accounts where username = 'reset_player'),
  'releasing a refused password keeps its code for a retry');
select public.username_reset_claim('reset_player', repeat('b',64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select reset_test.write_password('88888888-2222-4222-8222-222222222222', 'new-hash', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select reset_test.ok((select encrypted_password = 'new-hash' from auth.users where email = 'player@reset.test'),
  'a claimed reset changes the password with Auth statement ordering');
select reset_test.ok((select reset_hash is null and reset_claim_id is null and reset_expires_at is null
  from public.username_accounts where username = 'reset_player'), 'that same transaction consumes the code and releases the claim');
select reset_test.ok((select raw_app_meta_data = '{"providers":["email"],"other":"kept"}'::jsonb from auth.users where email = 'player@reset.test'),
  'the transient marker is removed and other app metadata stays');
select reset_test.refused($q$select reset_test.write_password('88888888-2222-4222-8222-222222222222',
  'replayed-hash', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, 'a used claim cannot change the password again');
select reset_test.ok((select encrypted_password = 'new-hash' from auth.users where email = 'player@reset.test'),
  'a replay rolls back the password update');

-- Act out the database failing when the code would be consumed. Since the
-- consumption is in Auth's transaction, the password must roll back too.
select public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-1111-4111-8111-111111111111', repeat('c',64), now()+interval '1 day');
select public.username_reset_claim('reset_player', repeat('c',64), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
create function reset_test.fail_consumption() returns trigger language plpgsql as $$
begin
  if old.reset_hash is not null and new.reset_hash is null then raise exception 'Simulated storage failure'; end if;
  return new;
end;
$$;
create trigger reset_test_storage_failure before update on public.username_accounts
  for each row execute function reset_test.fail_consumption();
select reset_test.refused($q$select reset_test.write_password('88888888-2222-4222-8222-222222222222',
  'failed-hash', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')$q$, 'a consumption failure prevents the password change from committing');
select reset_test.ok((select encrypted_password = 'new-hash' and not(raw_app_meta_data ? 'jt_username_reset_claim')
  from auth.users where email = 'player@reset.test'), 'both Auth writes roll back after a consumption failure');
select reset_test.ok((select reset_hash = repeat('c',64) from public.username_accounts where username = 'reset_player'),
  'the failed transaction leaves the code available');
drop trigger reset_test_storage_failure on public.username_accounts;
select public.username_reset_release('88888888-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select public.username_reset_claim('reset_player', repeat('c',64), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select reset_test.write_password('88888888-2222-4222-8222-222222222222', 'retry-hash', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

-- A worker can stop responding. Expiry allows recovery, while fencing still
-- stops its delayed Auth write, before or after a newer reset has finished.
select public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-1111-4111-8111-111111111111', repeat('e',64), now()+interval '1 day');
select public.username_reset_claim('reset_player', repeat('e',64), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
update public.username_accounts set reset_claimed_at = clock_timestamp() - interval '3 minutes' where username = 'reset_player';
select reset_test.refused($q$select reset_test.write_password('88888888-2222-4222-8222-222222222222',
  'late-hash', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$q$, 'a claim that timed out cannot commit a late password change');
select reset_test.ok(public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-1111-4111-8111-111111111111', repeat('f',64), now()+interval '1 day') = 'issued',
  'a captain can replace a code after an abandoned claim times out');
select reset_test.refused($q$select reset_test.write_password('88888888-2222-4222-8222-222222222222',
  'late-hash', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$q$, 'replacement also fences a delayed older request');
select reset_test.ok((select reset_hash = repeat('f',64) from public.username_accounts where username = 'reset_player'),
  'a stale request leaves the replacement code untouched');
select public.username_reset_claim('reset_player', repeat('f',64), 'ffffffff-ffff-4fff-8fff-ffffffffffff');
select reset_test.write_password('88888888-2222-4222-8222-222222222222', 'newest-hash', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
select reset_test.refused($q$select reset_test.write_password('88888888-2222-4222-8222-222222222222',
  'late-hash', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$q$, 'a late request cannot overwrite a completed newer reset');
select reset_test.ok((select encrypted_password = 'newest-hash' from auth.users where email = 'player@reset.test'),
  'the newer password stays in place');

select public.username_reset_issue('88888888-2222-4222-8222-222222222222',
  '88888888-1111-4111-8111-111111111111', repeat('a',64), now()-interval '1 second');
select reset_test.ok(public.username_reset_claim('reset_player', repeat('a',64), gen_random_uuid()) is null,
  'an expired code cannot be claimed');
select reset_test.write_password('88888888-2222-4222-8222-222222222222', 'ordinary-new-hash');
select reset_test.write_password('88888888-3333-4333-8333-333333333333', 'google-new-hash');
select reset_test.ok((select encrypted_password = 'ordinary-new-hash' from auth.users where email = 'player@reset.test'),
  'ordinary email password changes still work with no active reset');
select reset_test.ok((select encrypted_password = 'google-new-hash' from auth.users where email = 'ordinary@reset.test'),
  'a Google account can still add its first password');
rollback;
