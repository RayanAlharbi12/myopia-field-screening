# Phase 1 test scripts (reference)

These are the approved Phase 1 offline-app tests, kept unchanged for reference.
`qa_flow.py` and `glasses_previously.py` are re-run against Phase 2 by
`tests/e2e/phase1_regression.py` (signed in, data on the server). The others
(`touch_ipad.py`, `backup_edge.py`, `edit_id.py`, `screens.py`) exercise Phase 1
local-database features (local backup/restore, local ID editing) that Phase 2
replaces with server-side equivalents covered by `tests/e2e/`.
