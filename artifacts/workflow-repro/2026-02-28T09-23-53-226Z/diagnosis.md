# Workflow Repro Diagnosis

- run_id: a08a46aa-5ce7-4bb4-9f53-eb83a92f3c19
- POST status: 201
- SSE events captured: 11
- SSE reconnect from Last-Event-ID=9: 2 events
- Persisted events: 11
- Persisted artifacts: 1
- Final run status: completed

## Event Order Check

- seq=1 type=run_created ts=2026-02-28T09:23:53.431Z
- seq=2 type=step_started ts=2026-02-28T09:23:53.473Z
- seq=3 type=step_completed ts=2026-02-28T09:23:53.609Z
- seq=4 type=step_log ts=2026-02-28T09:23:53.694Z
- seq=5 type=step_started ts=2026-02-28T09:23:53.715Z
- seq=6 type=step_retried ts=2026-02-28T09:23:53.731Z
- seq=7 type=step_started ts=2026-02-28T09:23:53.837Z
- seq=8 type=step_completed ts=2026-02-28T09:23:53.854Z
- seq=9 type=step_started ts=2026-02-28T09:23:53.857Z
- seq=10 type=step_completed ts=2026-02-28T09:23:53.873Z
- seq=11 type=run_completed ts=2026-02-28T09:23:53.883Z
