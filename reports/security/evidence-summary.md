# Security Hardening Evidence (2026-02-18)

- npm audit (omit=dev):
  - `.` => 0
  - `apps/mobile` => 0
  - `Hola` => 0
  - `Hola_wt_super_agent_100` => 0
  - `Hola_wt_ci_fix` => 0
  - `Hola_wt_download_ui` => 0
  - `Hola_wt_github` => 0
  - `Hola_wt_pr` => 0
  - `iliagpt_skills_push` => 0
- Python dependency audit (pip-audit JSON):
  - All scanned manifests in `fastapi_sse/requirements.txt` and worktree variants => 0 vulnerabilities
- Python static analysis (Bandit, medium+):
  - Raw scan on default include path reported findings (198) including virtualenv artifacts.
  - Sanitized scan excluding `.venv` site-packages yielded **0 findings** (`bandit-report-sanitized.json`).
