#!/usr/bin/env bash
# Real independent database connections: a delayed Auth transaction must not
# commit an older password after a captain replaces its abandoned reset, and
# two resets that reach the code at the same moment can't both claim it.
set -euo pipefail
db="${1:?usage: scripts/test-username-reset-race.sh <scratch database>}"
query() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" "$@"; }
scratch=$(mktemp -d)
# Every connection this script opens carries this prefix, so cleanup can end
# them all, whatever step failed, and the scratch database can be dropped.
tag="jt_reset_race_$$"
gate_key=$((880000000 + $$))
jobs_started=()
# Runs psql in the background as its own tagged connection; its output goes to $scratch/<name>.log.
connect() {
  local name="$1"; shift
  ( trap - EXIT; PGAPPNAME="${tag}_$name" query "$@" ) >"$scratch/$name.log" 2>&1 &
  jobs_started+=("$!")
}
cleanup() {
  query -c "select pg_terminate_backend(pid) from pg_stat_activity
    where application_name like '${tag}_%' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  for job in "${jobs_started[@]}"; do wait "$job" 2>/dev/null || true; done
  rm -rf "$scratch"
}
trap cleanup EXIT

# Waits until the named connections are all waiting on this kind of event.
waiting() {
  local event_type="$1" event_name="$2"; shift 2
  local names
  names=$(printf "'${tag}_%s'," "$@")
  for attempt in {1..100}; do
    if [ "$(query -c "select count(*) from pg_stat_activity where application_name in (${names%,})
        and wait_event_type = '$event_type' and ('$event_name' = '' or wait_event = '$event_name')")" = "$#" ]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for reset race connections: $*" >&2
  return 1
}
# Ends one tagged connection, rolling back whatever it holds.
release() {
  query -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${tag}_$1'" >/dev/null
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
connect gate -c "select pg_advisory_lock($gate_key); select pg_sleep(45)"
waiting Timeout PgSleep gate
connect old -c "begin;
  update auth.users set encrypted_password = 'stale-hash' where id = '77777777-2222-4222-8222-222222222222';
  update auth.users set raw_app_meta_data = jsonb_build_object('jt_username_reset_claim', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    where id = '77777777-2222-4222-8222-222222222222';
  select pg_advisory_xact_lock($gate_key);
  commit;"
old_job="${jobs_started[-1]}"
waiting Lock advisory old
query -c "update public.username_accounts set reset_claimed_at = clock_timestamp()-interval '3 minutes' where username = 'race_player'" >/dev/null
issued=$(query -c "select public.username_reset_issue('77777777-2222-4222-8222-222222222222',
  '77777777-1111-4111-8111-111111111111', repeat('b',64), now()+interval '1 day') ->> 'status'")
[ "$issued" = issued ]
release gate
old_status=0
wait "$old_job" || old_status=$?
[ "$old_status" -ne 0 ]
grep -q 'This password reset is no longer current' "$scratch/old.log"
[ "$(query -c "select encrypted_password = 'original-hash' from auth.users where email = 'player@reset-race.test'")" = t ]
[ "$(query -c "select reset_hash = repeat('b',64) and reset_claim_id is null from public.username_accounts where username = 'race_player'")" = t ]
echo '  ok - an in-flight Auth transaction rolls back after its reset is replaced'

# Two callers compete for the replacement code. A transaction holding the row
# lets both start and wait on it, then lets them go at once: exactly one claims
# the code, and the other is told it's busy. A claim that read the row first
# and wrote it later would let both through here.
connect hold -c "begin; select 1 from public.username_accounts where username = 'race_player' for update; select pg_sleep(45);"
waiting Timeout PgSleep hold
connect first -c "select public.username_reset_claim('race_player', repeat('b',64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') ->> 'status'"
connect second -c "select public.username_reset_claim('race_player', repeat('b',64), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') ->> 'status'"
first_job="${jobs_started[-2]}"
second_job="${jobs_started[-1]}"
waiting Lock '' first second
release hold
wait "$first_job"
wait "$second_job"
[ "$(sort "$scratch/first.log" "$scratch/second.log" | tr '\n' ' ')" = 'busy claimed ' ]
echo '  ok - of two resets reaching a code at once, one claims it and the other is asked to wait'
