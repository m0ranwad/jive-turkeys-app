#!/usr/bin/env bash
# Rehearses a database update before it reaches the live database, and fails
# if it would lose or change any existing data (chat history included).
#
#   scripts/db-rehearsal.sh <git ref the live database currently matches>
#
# 1. Migration files already applied at that ref must be unchanged: deleting
#    or editing one breaks every later update (and edits never take effect).
# 2. A scratch database is built from that ref's migrations and filled with
#    sample data (supabase/tests/seed.sql). Every row is snapshotted.
# 3. The new migration files are applied. Every snapshotted row must still be
#    there with the same values (new columns are fine; updated_date is ignored).
#
# A new migration containing "-- owner-approved" (see CLAUDE.md) may remove or
# change data: the rehearsal then reports what it touched without failing.
# Needs Postgres 15+ and psql, connected through PG* variables like test-db.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

base="${1:?usage: scripts/db-rehearsal.sh <git ref the live database matches>}"
dir=supabase/migrations

base_files=$(git ls-tree --name-only "$base" -- "$dir/" | grep '\.sql$' | sort || true)
head_files=$(ls "$dir"/*.sql | sort)

problems=0
for f in $base_files; do
  if [ ! -f "$f" ]; then
    echo "::error file=$f::$f was already applied to the live database. Deleting it breaks every later database update. Restore it."
    problems=1
  elif ! git show "$base:$f" | cmp -s - "$f"; then
    echo "::error file=$f::$f was already applied to the live database, so edits to it never take effect. Restore it and put the change in a new migration file."
    problems=1
  fi
done
[ "$problems" -eq 0 ] || exit 1

new_files=$(comm -13 <(printf '%s\n' "$base_files") <(printf '%s\n' "$head_files") | sed '/^$/d')
if [ -z "$new_files" ]; then
  echo "::notice title=Database rehearsal::No new database changes to rehearse."
  exit 0
fi

db="jt_rehearsal_$$"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() { psql_q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
export PGOPTIONS='-c client_min_messages=warning'

psql_q -d postgres -c "create database $db"
psql_q -d "$db" -f supabase/tests/stubs.sql 2>/dev/null
for f in $base_files; do
  echo "live   $f"
  git show "$base:$f" | psql_q -d "$db"
done
psql_q -d "$db" -f supabase/tests/seed.sql
psql_q -d "$db" -f supabase/tests/snapshot.sql

for f in $new_files; do
  echo "new    $f"
  psql_q -d "$db" -f "$f"
done

approved=$(grep -l -- '-- owner-approved' $new_files || true)
set +e
PGOPTIONS='-c client_min_messages=notice' psql_q -d "$db" -f supabase/tests/compare.sql 2>&1 | sed -n 's/^psql:[^:]*:[0-9]*: \(NOTICE\|WARNING\|ERROR\):  /  /p'
code=${PIPESTATUS[0]}
set -e
rows=$(psql_q -d "$db" -At -c "select count(*) || ' rows in ' || count(distinct tbl) || ' tables' from rehearsal.snapshot")
applied=$(printf '%s\n' $new_files | xargs -n1 basename | paste -sd, - | sed 's/,/, /g')

if [ "$code" -eq 0 ]; then
  echo "Rehearsal passed: every existing row survived the new database changes."
  echo "::notice title=Database rehearsal::Applied $applied to a copy with sample data; all $rows were kept."
elif [ -n "$approved" ]; then
  echo "::warning::The new database changes remove or change existing data, as approved in: $approved"
else
  echo "::error::The new database changes would remove or change existing team data (see above). If that's intended, a co-owner must approve it and '-- owner-approved' goes in the migration file (see CLAUDE.md)."
  exit 1
fi
