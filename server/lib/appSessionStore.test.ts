import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("express-session", () => ({
  default: Object.assign(
    function session() {
      return {};
    },
    {
      MemoryStore: class MemoryStore {},
    },
  ),
}));

vi.mock("connect-pg-simple", () => ({
  default: () =>
    class MockPgStore {
      get(_sid: string, callback?: (error: Error | null, sessionData: unknown) => void) {
        callback?.(null, null);
      }
    },
}));

vi.mock("../db", () => ({
  pool: {},
}));

describe("shouldTreatStoreErrorAsMiss", () => {
  let shouldTreatStoreErrorAsMiss: typeof import("./appSessionStore").shouldTreatStoreErrorAsMiss;

  beforeEach(async () => {
    ({ shouldTreatStoreErrorAsMiss } = await import("./appSessionStore"));
  });

  it("treats postgres auth failures as recoverable session misses", () => {
    expect(
      shouldTreatStoreErrorAsMiss({
        code: "28P01",
        message: "password authentication failed for user",
      }),
    ).toBe(true);
  });

  it("treats transient connection failures as recoverable session misses", () => {
    expect(
      shouldTreatStoreErrorAsMiss(new Error("connect ETIMEDOUT 10.0.0.5:5432")),
    ).toBe(true);
  });

  it("keeps unrelated programmer errors visible", () => {
    expect(
      shouldTreatStoreErrorAsMiss(new Error("column user_id does not exist")),
    ).toBe(false);
  });
});
