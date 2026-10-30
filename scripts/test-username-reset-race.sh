#!/usr/bin/env bash
# Real independent database connections: a delayed Auth transaction must not
# commit an older password after a captain replaces its abandoned reset.
set -euo pipefail
db="${1:?usage: scripts/test-username-reset-race.sh <scratch database>}"
query() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" "$@"; }
scratch=$(mktemp -d)
gate_tag="jt_reset_gate_$$"
old_tag="jt_reset_old_$$"
gate_key=$((880000000 + $$))
gate_job=''
old_job=''
cleanup() {
  query -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('$gate_tag', '$old_tag') and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  [ -z "$gate_job" ] || wait "$gate_job" 2>/dev/null || true
  [ -z "$old_job" ] || wait "$old_job" 2>/dev/null || true
  rm -rf "$scratch"
}
trap cleanup EXIT

ready() {
  local tag="$1" event_type="$2" event_name="$3"
  for attempt in {1..100}; do
    if [ "$(query -c "select exists(select 1 from pg_stat_activity where application_name = '$tag' and wait_event_type = '$event_type' and wait_event = '$event_name')")" = t ]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for reset race connection: $tag" >&2
  return 1
}

query <<'SQL'
insert into auth.users(id, email, encrypted_password) values
  ('77777777-1111-4111-8111-111111111111', 'captain@reset-race.test', 'captain-hash'),
  ('77777777-2222-4222-8222-222222222222', 'player@reset-race.test', 'original-hash');
update public.users set role = 'admin' where id = '77777777-1111-4111-8111-111111111111';
insert into public.username_accounts(user_id, username, reset_hash, reset_expires_at, reset_claim_id, reset_claimed_at)
values ('77777777-2222-4222-8222-222222222222', 'race_player', repeat('a',64), now()+interval '1 day',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clock_timestamp());
SQL

# An advisory lock is only the test's pause button, never the app's protocol.
# The old transaction writes Auth's password before its metadata, then pauses
# before the deferred commit trigger. No filesystem is shared with psql.
(
  trap - EXIT
  query -c "set application_name = '$gate_tag'; select pg_advisory_lock($gate_key); select pg_sleep(45)"
) >"$scratch/gate.log" 2>&1 &
gate_job=$!
ready "$gate_tag" Timeout PgSleep
(
  trap - EXIT
  query -c "begin;
    set local application_name = '$old_tag';
    update auth.users set encrypted_password = 'stale-hash' where id = '77777777-2222-4222-8222-222222222222';
    update auth.users set raw_app_meta_data = jsonb_build_object('jt_username_reset_claim', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      where id = '77777777-2222-4222-8222-222222222222';
    select pg_advisory_xact_lock($gate_key);
    commit;"
) >"$scratch/old.log" 2>&1 &
old_job=$!
ready "$old_tag" Lock advisory
query -c "update public.username_accounts set reset_claimed_at = clock_timestamp()-interval '3 minutes' where username = 'race_player'" >/dev/null
issued=$(query -c "select public.username_reset_issue('77777777-2222-4222-8222-222222222222',
  '77777777-1111-4111-8111-111111111111', repeat('b',64), now()+interval '1 day')")
[ "$issued" = issued ]
query -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '$gate_tag'" >/dev/null
wait "$gate_job" 2>/dev/null || true
gate_job=''
old_status=0
wait "$old_job" || old_status=$?
old_job=''
[ "$old_status" -ne 0 ]
grep -q 'This password reset is no longer current' "$scratch/old.log"
[ "$(query -c "select encrypted_password = 'original-hash' from auth.users where email = 'player@reset-race.test'")" = t ]
[ "$(query -c "select reset_hash = repeat('b',64) and reset_claim_id is null from public.username_accounts where username = 'race_player'")" = t ]
echo '  ok - an in-flight Auth transaction rolls back after its reset is replaced'

# Two independent callers compete for the replacement: exactly one wins.
(
  trap - EXIT
  query -c "select public.username_reset_claim('race_player', repeat('b',64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')"
) >"$scratch/first.log" 2>&1 &
first_job=$!
(
  trap - EXIT
  query -c "select public.username_reset_claim('race_player', repeat('b',64), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')"
) >"$scratch/second.log" 2>&1 &
second_job=$!
wait "$first_job"
wait "$second_job"
[ "$(cat "$scratch/first.log" "$scratch/second.log" | grep -cx '77777777-2222-4222-8222-222222222222')" = 1 ]
echo '  ok - only one of two database connections can claim a reset code'
