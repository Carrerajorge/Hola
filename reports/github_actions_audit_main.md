# GitHub Actions Audit (main)

Generated: 2026-02-17
Scope: Full paginated history available via GitHub API for `branch=main`.

## Coverage
- Total runs analyzed: **1000** (11 pages x 100 max API page size)
- Workflows included: CI, CodeQL, Deploy to Production (Blue-Green), legacy deploy workflows, Dependabot workflow runs

## Aggregate findings
- Success: **403**
- Failure: **155**
- Cancelled: **364**
- Skipped: **75**
- In progress at audit time: **3**

### Dominant failure/cancellation patterns
1. `Deploy to Production (Blue-Green) / Blue-Green Deploy (Auto)`
   - Failures concentrated in:
     - `Run blue-green deploy`
     - `Sync deploy scripts to VPS`
     - occasional `Verify production`
2. High cancellation volume in CI/CodeQL/deploy due overlapping pushes and queue pressure.
3. Transient CI instability observed in `Unit Tests` and `Build` (infrequent but present).

## Root causes
- SSH endpoint brittleness (single host/port assumption) caused intermittent `scp/ssh` timeout failures.
- No resilient sync loop for deployment script transfer.
- Queue pressure due non-cancelling concurrency settings increased stale runs and cancellation churn.
- Insufficient deploy guardrails for repeated failures (no circuit breaker).
- Build/dependency steps lacked robust retry on transient network/package registry faults.

## Structural remediations applied
### 1) Deploy hardening (`.github/workflows/deploy.yml`)
- Added host/port fallback resolution with active SSH reachability probing.
- Added resilient script sync retries (3 attempts).
- Enabled deploy concurrency cancellation of stale in-progress runs (`cancel-in-progress: true`).
- Added deploy circuit-breaker step (aborts auto deploy on repeated recent failures).
- Strengthened production verification with SSL check + 5xx guardrail in addition to health checks.
- Added actions read permission for workflow introspection where needed.

### 2) CI hardening (`.github/workflows/ci.yml`)
- Enabled cancellation of stale in-progress CI runs (`cancel-in-progress: true`).
- Added deterministic retry wrappers for `npm ci` in all Node jobs.
- Added retry wrappers for unstable execution steps (`test`, `build`).

### 3) CodeQL hardening (`.github/workflows/codeql.yml`)
- Enabled cancellation of stale in-progress runs (`cancel-in-progress: true`).

## Residual risk / items requiring follow-up
- Repository still reports dependency vulnerabilities (GitHub advisory summary seen during push). These are dependency remediation tasks, not workflow mechanics; require dedicated package upgrade cycle.
- One local unit test failed during broad local run (`chatSkillsIntegration` fast-path expectation). This appears application-test behavior, not pipeline YAML syntax. Should be triaged in app test suite stabilization PR.

## Validation performed before push
- YAML parse validation for modified workflows (`ci.yml`, `codeql.yml`, `deploy.yml`) passed.
- Local unit test simulation executed (`npm run test:run -- --silent --passWithNoTests`), revealing one pre-existing/flaky app test unrelated to workflow syntax.

## Expected impact
- Lower deploy flakiness from SSH endpoint variability.
- Reduced stale-run cancellations and queue contention.
- Better tolerance to transient network/package issues.
- Safer auto-deploy behavior under repeated failure conditions.
