import { beforeEach, describe, expect, it, vi } from "vitest";

const dbExecute = vi.fn();
const dbReadExecute = vi.fn();
const isOwnedByUserMock = vi.fn();
const is2FAEnabledMock = vi.fn();

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => dbExecute(...args),
  },
  dbRead: {
    execute: (...args: any[]) => dbReadExecute(...args),
  },
}));

vi.mock("../lib/sessionIdentity", () => ({
  isOwnedByUser: (...args: any[]) => isOwnedByUserMock(...args),
}));

vi.mock("./twoFactorAuth", () => ({
  is2FAEnabled: (...args: any[]) => is2FAEnabledMock(...args),
}));

vi.mock("./loginApprovals", () => ({
  createLoginApproval: vi.fn(),
  expireLoginApproval: vi.fn(),
}));

vi.mock("./webPush", () => ({
  sendWebPush: vi.fn(),
}));

import { computeMfaForUser, getPushTargetsForUser } from "./mfaLogin";

describe("mfaLogin", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    dbReadExecute.mockReset();
    isOwnedByUserMock.mockReset();
    is2FAEnabledMock.mockReset();

    isOwnedByUserMock.mockReturnValue(true);
  });

  it("falls back to the primary database when the read replica session lookup fails", async () => {
    dbReadExecute.mockRejectedValueOnce(new Error("read replica unavailable"));
    dbExecute.mockResolvedValueOnce({
      rows: [
        {
          sid: "sid-primary",
          sess: {
            authUserId: "user-123",
            security: { pushApprovalsEnabled: true },
            push: { subscription: { endpoint: "https://push.example/1" } },
          },
        },
      ],
    });

    const result = await getPushTargetsForUser({ userId: "user-123" });

    expect(dbReadExecute).toHaveBeenCalledTimes(1);
    expect(dbExecute).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        sid: "sid-primary",
        subscription: { endpoint: "https://push.example/1" },
      },
    ]);
  });

  it("still requires MFA when TOTP succeeds and push target lookup recovers via primary", async () => {
    is2FAEnabledMock.mockResolvedValueOnce(true);
    dbReadExecute.mockRejectedValueOnce(new Error("read replica timeout"));
    dbExecute.mockResolvedValueOnce({ rows: [] });

    const result = await computeMfaForUser({ userId: "user-123", excludeSid: "sid-current" });

    expect(result).toMatchObject({
      totpEnabled: true,
      methods: { totp: true, push: false },
      requiresMfa: true,
    });
  });

  it("keeps push MFA available when the TOTP check fails", async () => {
    is2FAEnabledMock.mockRejectedValueOnce(new Error("user_2fa lookup failed"));
    dbReadExecute.mockResolvedValueOnce({
      rows: [
        {
          sid: "sid-push",
          sess: {
            authUserId: "user-123",
            security: { pushApprovalsEnabled: true },
            push: { subscription: { endpoint: "https://push.example/2" } },
          },
        },
      ],
    });

    const result = await computeMfaForUser({ userId: "user-123" });

    expect(result).toMatchObject({
      totpEnabled: false,
      methods: { totp: false, push: true },
      requiresMfa: true,
    });
    expect(result.pushTargets).toHaveLength(1);
  });

  it("throws a controlled MFA_LOOKUP_FAILED error only when every MFA lookup path fails", async () => {
    is2FAEnabledMock.mockRejectedValueOnce(new Error("totp unavailable"));
    dbReadExecute.mockRejectedValueOnce(new Error("replica down"));
    dbExecute.mockRejectedValueOnce(new Error("primary down"));

    await expect(computeMfaForUser({ userId: "user-123" })).rejects.toMatchObject({
      code: "MFA_LOOKUP_FAILED",
    });
  });
});
