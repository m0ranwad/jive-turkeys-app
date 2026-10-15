#!/usr/bin/env bash
# Checks a nightly backup can actually be restored: loads it into a scratch
# database and makes sure every team table has as many rows as the backup says.
#
#   scripts/backup-check.sh <folder with roles.sql, schema.sql, data.sql>
#
# Needs Postgres 15+ and psql, connected through PG* variables like test-db.sh.
# Supabase's own schemas (auth, storage, ...) only get stand-ins here
# (supabase/tests/stubs.sql), so only the team data in "public" is compared.
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:?usage: scripts/backup-check.sh <backup folder>}"
for f in schema.sql data.sql; do
  [ -s "$dir/$f" ] || { echo "::error::The backup has no $f (or it's empty)."; exit 1; }
done

db="jt_backup_check_$$"
psql_q() { psql -X -q "$@"; }
cleanup() { psql_q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql_q -d postgres -c "create database $db" >/dev/null
export PGOPTIONS='-c client_min_messages=warning'
psql_q -d "$db" -f supabase/tests/stubs.sql >/dev/null 2>&1
# Supabase-only pieces (extensions, its own roles and schemas) don't exist here; those errors are expected.
[ -s "$dir/roles.sql" ] && psql_q -d "$db" -f "$dir/roles.sql" >/dev/null 2>&1 || true
psql_q -d "$db" -f "$dir/schema.sql" >/dev/null 2>"$dir/.schema-errors" || true
# Rows go in as they were: the database's own triggers (new accounts, session lists) stay off while loading.
PGOPTIONS="$PGOPTIONS -c session_replication_role=replica" psql_q -d "$db" -f "$dir/data.sql" >/dev/null 2>"$dir/.data-errors" || true

# Rows per public table in the backup: the lines between each COPY ... FROM stdin; and its \.
expected=$(awk '
  /^COPY "?public"?\."?[a-z_]+"? / { split($2, parts, "."); t = parts[2]; gsub(/"/, "", t); n = 0; inside = 1; next }
  inside && /^\\\.$/ { print t, n; inside = 0; next }
  inside { n++ }
' "$dir/data.sql")
if [ -z "$expected" ]; then
  echo "::error::The backup has no team data in it."
  exit 1
fi

status=0
total=0
while read -r table rows; do
  got=$(psql -X -At -d "$db" -c "select count(*) from public.\"$table\"" 2>/dev/null || echo "missing")
  if [ "$got" != "$rows" ]; then
    echo "::error::$table: the backup has $rows rows, but $got came back in the restore."
    status=1
  else
    printf '  %-24s %s rows\n' "$table" "$rows"
  fi
  total=$((total + rows))
done <<< "$expected"

if [ "$status" -ne 0 ]; then
  echo "Backup check FAILED. First errors while restoring:"
  head -20 "$dir/.schema-errors" "$dir/.data-errors" || true
  exit 1
fi
echo "Backup check passed: $total rows of team data restored."
rm -f "$dir/.schema-errors" "$dir/.data-errors"
