# Workflow Repro Diagnosis

- run_id: 201ff418-df22-4855-839b-70fd37aa86f6
- POST status: 201
- SSE events captured: 11
- SSE reconnect from Last-Event-ID=9: 2 events
- Persisted events: 11
- Persisted artifacts: 1
- Final run status: completed

## Event Order Check

- seq=1 type=run_created ts=2026-02-28T09:25:02.633Z
- seq=2 type=step_started ts=2026-02-28T09:25:02.649Z
- seq=3 type=step_completed ts=2026-02-28T09:25:02.742Z
- seq=4 type=step_log ts=2026-02-28T09:25:02.746Z
- seq=5 type=step_started ts=2026-02-28T09:25:02.754Z
- seq=6 type=step_retried ts=2026-02-28T09:25:02.766Z
- seq=7 type=step_started ts=2026-02-28T09:25:02.871Z
- seq=8 type=step_completed ts=2026-02-28T09:25:02.889Z
- seq=9 type=step_started ts=2026-02-28T09:25:02.894Z
- seq=10 type=step_completed ts=2026-02-28T09:25:02.916Z
- seq=11 type=run_completed ts=2026-02-28T09:25:02.930Z
