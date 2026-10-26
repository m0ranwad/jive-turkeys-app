#!/usr/bin/env bash
# Exercise a roster-name pick made before couples were kept per session.
# A clean-schema test can't catch missing tracking data on those old picks.
set -euo pipefail
cd "$(dirname "$0")/.."

db="jt_couples_upgrade_$$"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() { psql_q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
export PGOPTIONS='-c client_min_messages=warning'

psql_q -d postgres -c "create database $db"
psql_q -d "$db" -f supabase/tests/stubs.sql 2>/dev/null
for f in supabase/migrations/*.sql; do
  if [[ "$f" == supabase/migrations/20261026160000_couples_per_session.sql ]]; then
    psql_q -d "$db" -f supabase/tests/upgrades/couples.before.sql >/dev/null
  fi
  psql_q -d "$db" -f "$f"
done
echo "test   couples upgrade: undo a pick made before the update"
PGOPTIONS='-c client_min_messages=notice' psql_q -d "$db" -f supabase/tests/upgrades/couples.after.sql
