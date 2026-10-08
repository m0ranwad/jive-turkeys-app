#!/usr/bin/env bash
# Database tests: builds a scratch database from every migration, then runs
# each supabase/tests/*.test.sql file against it.
#
# Needs a Postgres 15+ server and psql. Connection comes from the usual PG*
# variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); the user must be able to
# create databases. In CI this is a Postgres service container.
set -euo pipefail
cd "$(dirname "$0")/.."

db="jt_test_$$"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() { psql_q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_q -d postgres -c "create database $db"
export PGOPTIONS='-c client_min_messages=warning'
psql_q -d "$db" -f supabase/tests/stubs.sql 2>/dev/null
for f in supabase/migrations/*.sql; do
  echo "apply  $f"
  psql_q -d "$db" -f "$f"
done

status=0
for t in supabase/tests/*.test.sql; do
  echo "test   $t"
  set +e
  output=$(PGOPTIONS='-c client_min_messages=notice' psql_q -d "$db" -f "$t" 2>&1)
  code=$?
  set -e
  # "psql:file:12: NOTICE:  ok - ..." -> "  ok - ..."; failures keep their line number.
  echo "$output" | sed -n -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /p' -e 's/^psql:[^:]*:\([0-9]*\): ERROR:  /  line \1: /p'
  if [ "$code" -ne 0 ]; then status=1; fi
done

if [ "$status" -ne 0 ]; then
  echo "Database tests FAILED"
else
  echo "Database tests passed"
fi
exit "$status"
