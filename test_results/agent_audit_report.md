# Agent Module Audit Report

**Generated**: 2026-01-02T17:30:00Z  
**Auditor**: Automated Audit Pipeline  
**Scope**: server/agent/* (excluding webtool/)  
**Test Results**: 295 tests passing (81 agent + 39 chaos + 5 benchmarks + 170 webtool)

## Executive Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| P0 (Critical) | 3 | ❌ |
| P1 (Important) | 5 | ❌ |
| P2 (Minor) | 4 | ❌ |

---

## P0 - Critical Issues

### P0-1: Idempotency Key Generation Not Deterministic
**File**: `server/agent/idempotency.ts:44-48`  
**Type**: Bug - Race Condition  
**Description**: `generateIdempotencyKey()` includes `Date.now()` making identical requests generate different keys. This defeats the purpose of idempotency.

```typescript
// CURRENT (BROKEN)
export function generateIdempotencyKey(chatId: string, message: string): string {
  const hash = createHash("sha256");
  hash.update(`${chatId}:${message}:${Date.now()}`);  // ← Date.now() makes it non-deterministic!
  return hash.digest("hex").substring(0, 32);
}
```

**Fix**: Remove `Date.now()` from hash input, use only chatId + message.

---

### P0-2: Database Lock Not Implemented
**File**: `server/agent/dbTransactions.ts:56-73`  
**Type**: Bug - Race Condition  
**Description**: `acquireRunLock()` claims to acquire a lock but only checks if the run exists. No actual lock mechanism (SELECT FOR UPDATE, advisory locks, or external lock).

```typescript
// CURRENT (NO-OP)
export async function acquireRunLock(runId: string, lockDurationMs: number = 30000): Promise<boolean> {
  // ... just checks if run exists, doesn't acquire any lock
  const [run] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, runId));
  if (!run) return false;
  console.log(`[DBTransaction] Acquired lock...`);  // ← Lies!
  return true;
}
```

**Fix**: Implement actual lock using `SELECT FOR UPDATE NOWAIT` or PostgreSQL advisory locks.

---

### P0-3: Sandbox Security Network Config Inconsistent
**File**: `server/agent/sandboxSecurity.ts:23-31`  
**Type**: Configuration Gap  
**Description**: Default config has `allowNetwork: false` and empty `allowedHosts`. The WebTool adapters check `isHostAllowed()` but this always returns false because network is disabled.

```typescript
// CURRENT - always denies network
const DEFAULT_CONFIG: SandboxConfig = {
  allowNetwork: false,  // ← Blocks all network
  allowedHosts: [],     // ← No hosts allowed
  // ...
};
```

**Fix**: Create separate configs for different tool types. Web tools need network access with proper host allowlist.

---

## P1 - Important Issues

### P1-1: TransitionGuards Incomplete
**File**: `server/agent/stateMachine.ts:59-72`  
**Type**: Coverage Gap  
**Description**: Only 2 transition guards defined (running→verifying, verifying→completed). Missing guards for critical transitions like:
- queued→planning (should verify plan exists)
- planning→running (should verify plan is valid)
- failed→queued (should check retry eligibility)

**Impact**: Invalid state transitions may be allowed silently.

**Fix**: Add guards for all state transitions with precondition checks.

---

### P1-2: Error Classification Fragile
**File**: `server/agent/executionEngine.ts:421-437`  
**Type**: Flakiness Risk  
**Description**: `isRetryableError()` uses string pattern matching on error messages. This is fragile - error messages can change.

```typescript
// CURRENT (FRAGILE)
private isRetryableError(error: any): boolean {
  const retryablePatterns = [
    "ETIMEDOUT", "ECONNRESET", "timeout", "rate limit", "503", "502", "429"
  ];
  const errorString = (error.message || "").toLowerCase();
  return retryablePatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
}
```

**Fix**: Use structured error codes. Create `RetryableError` class with explicit `isRetryable` property.

---

### P1-3: MetricsCollector Memory Unbounded
**File**: `server/agent/metricsCollector.ts:42-49`  
**Type**: Memory Leak Risk  
**Description**: `record()` appends to Map without limit. In long-running server, this grows unbounded.

```typescript
// CURRENT (UNBOUNDED)
record(metrics: StepMetrics): void {
  const existing = this.metrics.get(metrics.toolName) || [];
  existing.push(metrics);  // ← Never trimmed!
  this.metrics.set(metrics.toolName, existing);
}
```

**Fix**: Add rolling window (e.g., keep last 1000 per tool) or time-based expiry.

---

### P1-4: Rate Limit Counted Before Success
**File**: `server/agent/policyEngine.ts:157-179`  
**Type**: Logic Bug  
**Description**: Rate limit counter increments before tool execution. Failed calls still count toward limit.

```typescript
// CURRENT (COUNTS BEFORE SUCCESS)
if (callData) {
  if (now - callData.windowStart < policy.rateLimit.windowMs) {
    if (callData.count >= policy.rateLimit.maxCalls) { /* deny */ }
    callData.count++;  // ← Counted before tool runs!
  }
}
```

**Fix**: Count after successful execution, or use separate counters for attempts vs successes.

---

### P1-5: ExecutionEngine Timeout Race
**File**: `server/agent/executionEngine.ts:371-399`  
**Type**: Race Condition  
**Description**: `executeWithTimeout()` doesn't clear the cancellation handler after promise resolves. If cancel happens after success, handler still fires.

```typescript
// CURRENT (RACE)
if (cancellationToken) {
  cancellationToken.onCancelled(cancelHandler);  // ← Never unregistered
}
fn().then(result => {
  clearTimeout(timeoutId);
  resolve(result);  // ← cancelHandler may still fire later
});
```

**Fix**: Track and remove cancellation handler after resolution.

---

## P2 - Minor Issues

### P2-1: Artifact Schema Uses z.any()
**File**: `server/agent/contracts.ts:26`  
**Type**: Type Safety Gap  
**Description**: `ArtifactSchema.data` uses `z.any()` - no validation of artifact data structure.

**Fix**: Define specific data schemas per artifact type (ImageArtifactData, DocumentArtifactData, etc.)

---

### P2-2: ValidationError Stack Trace Missing
**File**: `server/agent/validation.ts:22-27`  
**Type**: Debugging Difficulty  
**Description**: `ValidationError` doesn't preserve original stack trace, making debugging harder.

**Fix**: Capture and expose original stack in ValidationError constructor.

---

### P2-3: TransitionHistory Unbounded
**File**: `server/agent/stateMachine.ts:89-94`  
**Type**: Memory Leak Risk  
**Description**: `transitionHistory` array in state machines grows unbounded for long-running runs.

**Fix**: Limit history to last N transitions or use external event store.

---

### P2-4: CircuitBreaker States Not Persisted
**File**: `server/agent/executionEngine.ts:99-183`  
**Type**: Resilience Gap  
**Description**: Circuit breaker state is in-memory only. Server restart resets all circuits.

**Fix**: Persist circuit state to Redis or database for cross-instance consistency.

---

## Test Coverage Gaps

| Module | Current Coverage | Missing Tests |
|--------|-----------------|---------------|
| idempotency.ts | 0% | Needs duplicate detection tests |
| dbTransactions.ts | 0% | Needs lock conflict tests |
| eventLogger.ts | ~20% | Missing error event tests |
| sandboxSecurity.ts | 50% | Missing network config tests |

---

## Recommended Fix Priority

1. **Immediate (P0)**: Fix idempotency, implement real DB lock, fix sandbox config
2. **Next Sprint (P1)**: Add transition guards, fix error classification, add metrics limits
3. **Backlog (P2)**: Improve type safety, add stack traces, consider persistence

---

## Evidence Commands

```bash
# Run all agent tests
npx vitest run server/agent/__tests__

# Check test coverage
npx vitest run server/agent/__tests__ --coverage

# Run certification
npm run agent:certify
```

---

*Report generated by audit pipeline*
