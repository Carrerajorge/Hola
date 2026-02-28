# Workflow Repro Diagnosis

- run_id: 710cc919-40fd-4073-90f9-607b276182e1
- POST status: 201
- SSE events captured: 11
- SSE reconnect from Last-Event-ID=9: 2 events
- Persisted events: 11
- Persisted artifacts: 1
- Final run status: completed

## Event Order Check

- seq=1 type=run_created ts=2026-02-28T09:29:02.083Z
- seq=2 type=step_started ts=2026-02-28T09:29:02.112Z
- seq=3 type=step_completed ts=2026-02-28T09:29:02.210Z
- seq=4 type=step_log ts=2026-02-28T09:29:02.214Z
- seq=5 type=step_started ts=2026-02-28T09:29:02.224Z
- seq=6 type=step_retried ts=2026-02-28T09:29:02.239Z
- seq=7 type=step_started ts=2026-02-28T09:29:02.344Z
- seq=8 type=step_completed ts=2026-02-28T09:29:02.368Z
- seq=9 type=step_started ts=2026-02-28T09:29:02.372Z
- seq=10 type=step_completed ts=2026-02-28T09:29:02.392Z
- seq=11 type=run_completed ts=2026-02-28T09:29:02.400Z
