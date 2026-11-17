#!/usr/bin/env bash
# Database tests on a local PostgreSQL 16 (TEST-ONLY role emulation):
#   1. setup.sql applies to an empty database, twice (idempotent)
#   2. the RLS / security suite passes
#   3. parallel create_participant calls never collide
# Usage: PSQL="psql -h /tmp -p 54329 -U postgres" bash tests/db/run_db_tests.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
PSQL="${PSQL:-psql -h /tmp -p 54329 -U postgres}"
DB=mfs_dbtest
q() { $PSQL -v ON_ERROR_STOP=1 -q "$@"; }
q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
q -d $DB -f "$root/tests/harness/supabase_emulation.sql" >/dev/null 2>&1
q -d $DB -f "$root/supabase/setup.sql" >/dev/null 2>&1 && echo "PASS setup.sql applied to an empty database"
q -d $DB -f "$root/supabase/setup.sql" >/dev/null 2>&1 && echo "PASS setup.sql re-applied (idempotent)"
n=$($PSQL -d $DB -At -c "select (select count(*) from public.schools) + (select count(*) from public.participants) + (select count(*) from public.profiles)")
[ "$n" = "0" ] && echo "PASS no demo data" || { echo "FAIL demo data found"; exit 1; }
out=$(q -d $DB -f "$root/supabase/tests/rls_tests.sql" 2>&1)
echo "$out" | grep -q "ALL PASSED" && echo "PASS RLS suite: $(echo "$out" | grep -o 'ALL PASSED ([0-9]* checks)')" || { echo "$out" | grep -E "FAIL|FAILED"; exit 1; }
q -d postgres -c "drop database $DB" >/dev/null
PSQL="$PSQL" bash "$here/concurrency_test.sh" | grep -E "PASSED|FAILED|participants="
