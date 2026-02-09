/**
 * Circuit breaker for agentic chat operations.
 * Tracks success/failure rates and temporarily disables the agentic path
 * if too many failures occur.
 */

interface CircuitBreakerState {
  failures: number;
  successes: number;
  lastFailure: number | null;
  isOpen: boolean;
}

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 60000; // 1 minute

const state: CircuitBreakerState = {
  failures: 0,
  successes: 0,
  lastFailure: null,
  isOpen: false,
};

function isAvailable(): boolean {
  if (!state.isOpen) return true;

  // Check if enough time has passed to try again (half-open)
  if (state.lastFailure && Date.now() - state.lastFailure > RESET_TIMEOUT_MS) {
    state.isOpen = false;
    state.failures = 0;
    return true;
  }

  return false;
}

function recordSuccess(): void {
  state.successes++;
  state.failures = 0;
  state.isOpen = false;
}

function recordFailure(): void {
  state.failures++;
  state.lastFailure = Date.now();

  if (state.failures >= FAILURE_THRESHOLD) {
    state.isOpen = true;
    console.warn('[ChatAgenticCircuit] Circuit opened after', state.failures, 'failures');
  }
}

function reset(): void {
  state.failures = 0;
  state.successes = 0;
  state.lastFailure = null;
  state.isOpen = false;
}

export const chatAgenticCircuit = {
  isAvailable,
  recordSuccess,
  recordFailure,
  reset,
};
