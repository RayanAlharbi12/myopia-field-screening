#!/usr/bin/env bash
# Runs every automated test of Phase 2 (see TESTING.md).
# Needs: PostgreSQL 16 on /tmp:54329 (role emulation is created by the tests),
#        Bun, Node 22, Python 3 with Playwright (Chromium) and openpyxl.
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
run() { echo; echo "=== $1"; shift; "$@" || status=1; }
run "database: setup, RLS, concurrency" bash tests/db/run_db_tests.sh
run "Edge Function unit tests" bun test tests/functions
run "Edge Functions over HTTP" python3 tests/e2e/test_functions_http.py
run "Phase 2 end-to-end (spec tests 1-35)" python3 tests/e2e/test_phase2.py
run "field-level merge, Phase 1 import, backup/restore" python3 tests/e2e/test_sync_import.py
run "approved Phase 1 behaviour on Phase 2" python3 tests/e2e/phase1_regression.py
run "production build, CSP, offline reload, PWA update" python3 tests/e2e/test_dist.py
echo; [ $status = 0 ] && echo "ALL TEST GROUPS PASSED" || echo "SOME TEST GROUPS FAILED"
exit $status
