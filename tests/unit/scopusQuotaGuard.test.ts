import { beforeEach, describe, expect, it } from "vitest";
import {
  checkScopusQuotaGate,
  resetScopusQuotaGuardStateForTests,
  updateScopusQuotaFromHeaders,
} from "../../server/services/scopusQuotaGuard";

describe("scopusQuotaGuard", () => {
  beforeEach(() => {
    resetScopusQuotaGuardStateForTests();
  });

  it("allows requests by default", () => {
    const gate = checkScopusQuotaGate();
    expect(gate.allowed).toBe(true);
  });

  it("pauses before hard limit when soft threshold is reached", () => {
    const resetAtSec = Math.floor((Date.now() + 60_000) / 1000).toString();
    updateScopusQuotaFromHeaders(
      {
        "x-ratelimit-limit": "1000",
        "x-ratelimit-remaining": "50",
        "x-ratelimit-reset": resetAtSec,
      },
      200,
    );

    const gate = checkScopusQuotaGate();
    expect(gate.allowed).toBe(false);
    expect(gate.retryAtMs).toBeGreaterThan(Date.now());
  });

  it("pauses when provider returns 429", () => {
    const resetAtSec = Math.floor((Date.now() + 90_000) / 1000).toString();
    updateScopusQuotaFromHeaders({ "x-ratelimit-reset": resetAtSec }, 429);

    const gate = checkScopusQuotaGate();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("429");
  });

  it("auto-reopens when quota recovers above threshold", () => {
    const resetAtSec = Math.floor((Date.now() + 60_000) / 1000).toString();
    updateScopusQuotaFromHeaders(
      {
        "x-ratelimit-limit": "1000",
        "x-ratelimit-remaining": "50",
        "x-ratelimit-reset": resetAtSec,
      },
      200,
    );
    expect(checkScopusQuotaGate().allowed).toBe(false);

    updateScopusQuotaFromHeaders(
      {
        "x-ratelimit-limit": "1000",
        "x-ratelimit-remaining": "800",
      },
      200,
    );

    expect(checkScopusQuotaGate().allowed).toBe(true);
  });
});

