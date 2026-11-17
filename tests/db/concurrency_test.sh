#!/usr/bin/env bash
# TEST-ONLY. Creates participants from several parallel database sessions in the
# same school and checks that every Participant ID is unique and consecutive.
# Usage: PSQL="psql -h /tmp -p 54329 -U postgres" ./concurrency_test.sh
# Runs against a throw-away database (mfs_concurrency) that it creates and drops.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
PSQL="${PSQL:-psql -h /tmp -p 54329 -U postgres}"
DB=mfs_concurrency
SESSIONS="${SESSIONS:-6}"
PER="${PER:-40}"
q() { $PSQL -v ON_ERROR_STOP=1 -qAt "$@"; }

q -d postgres -c "drop database if exists $DB" -c "create database $DB"
q -d $DB -f "$root/tests/harness/supabase_emulation.sql" >/dev/null 2>&1
q -d $DB -f "$root/supabase/setup.sql" >/dev/null 2>&1
q -d $DB <<'SQL'
insert into auth.users (id, email) values
 ('00000000-0000-4000-8000-0000000000a1','conc-admin@test.invalid'),
 ('00000000-0000-4000-8000-0000000000e1','conc-ex1@test.invalid'),
 ('00000000-0000-4000-8000-0000000000e2','conc-ex2@test.invalid');
insert into public.profiles (id,email,full_name,role,active,must_change_password) values
 ('00000000-0000-4000-8000-0000000000a1','conc-admin@test.invalid','A','admin',true,false),
 ('00000000-0000-4000-8000-0000000000e1','conc-ex1@test.invalid','E1','examiner',true,false),
 ('00000000-0000-4000-8000-0000000000e2','conc-ex2@test.invalid','E2','examiner',true,false);
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set role authenticated;
select public.create_school('Concurrency School','City','boys');
SQL
SCHOOL=$(q -d $DB -c "select id from public.schools where number = 1")

start=$(date +%s.%N)
for i in $(seq 1 "$SESSIONS"); do
  uid=$([ $((i % 2)) -eq 0 ] && echo e1 || echo e2)
  (
    {
      echo "set request.jwt.claims = '{\"sub\":\"00000000-0000-4000-8000-0000000000$uid\",\"role\":\"authenticated\"}';"
      echo "set role authenticated;"
      for _ in $(seq 1 "$PER"); do echo "select public.create_participant('$SCHOOL');"; done
    } | q -d $DB >/dev/null
  ) &
done
wait
end=$(date +%s.%N)

total=$((SESSIONS * PER))
q -d $DB <<SQL
select 'participants=' || count(*) || ' distinct_seq=' || count(distinct seq) || ' min=' || min(seq) || ' max=' || max(seq)
       || ' distinct_code=' || count(distinct code) from public.participants;
select 'next_counter=' || next_participant_seq || ' last_assigned=' || last_assigned_seq from public.schools;
select 'station_rows=' || count(*) from public.station_status;
select 'audit_creates=' || count(*) from public.audit_log where action = 'participant.create';
select case when count(*) = $total and count(distinct seq) = $total and min(seq) = 1 and max(seq) = $total
            and (select next_participant_seq from public.schools) = $total + 1
            and (select count(*) from public.station_status) = $total * 5
       then 'CONCURRENCY TEST PASSED' else 'CONCURRENCY TEST FAILED' end from public.participants;
SQL
echo "sessions=$SESSIONS per_session=$PER elapsed=$(echo "$end - $start" | bc)s"
q -d postgres -c "drop database $DB"
