#!/usr/bin/env bash
# Waits until the live database has every database update in this commit
# (each supabase/migrations/ file is in supabase_migrations.schema_migrations,
# where `supabase db push` records it). functions.yml runs this before putting
# new Supabase functions live: the Database update workflow applies a
# publish's migrations separately and takes several minutes, and a function
# must never run against a database that's missing what it calls. If the
# update fails, this times out and nothing new is deployed.
#
# Needs SUPABASE_DB_URL. WAIT_SECONDS (default 1800) and POLL_SECONDS
# (default 20) are for tests.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_DB_URL:?Add the SUPABASE_DB_URL repository secret (see database.yml).}"
wait_seconds="${WAIT_SECONDS:-1800}"
poll_seconds="${POLL_SECONDS:-20}"

expected=$(for f in supabase/migrations/*.sql; do basename "$f" | cut -d_ -f1; done | sort)
deadline=$((SECONDS + wait_seconds))
while :; do
  if applied=$(psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -c 'select version from supabase_migrations.schema_migrations' | sort); then
    missing=$(comm -23 <(echo "$expected") <(echo "$applied"))
    if [ -z "$missing" ]; then
      echo "The live database has every database update in this commit."
      exit 0
    fi
    echo "Waiting for the Database update workflow to apply: $(tr '\n' ' ' <<< "$missing")"
  else
    echo "Couldn't read the live database's updates; trying again."
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::The live database is still missing database updates after $((wait_seconds / 60)) minutes. Check the Database update workflow; nothing new was deployed."
    exit 1
  fi
  sleep "$poll_seconds"
done
