import { describe, expect, it } from "vitest";

import { shouldSuppressQueryErrorToast } from "@/lib/queryClient";

describe("shouldSuppressQueryErrorToast", () => {
  it("suppresses toasts for queries explicitly marked as background-only", () => {
    expect(
      shouldSuppressQueryErrorToast({
        meta: { suppressGlobalErrorToast: true },
        state: {},
      }),
    ).toBe(true);
  });

  it("suppresses toasts for background refreshes when cached data already exists", () => {
    expect(
      shouldSuppressQueryErrorToast({
        state: { data: { ok: true } },
      }),
    ).toBe(true);
  });

  it("suppresses toasts for polling queries", () => {
    expect(
      shouldSuppressQueryErrorToast({
        options: { refetchInterval: 15_000 },
        state: {},
      }),
    ).toBe(true);

    expect(
      shouldSuppressQueryErrorToast({
        options: { refetchInterval: () => 30_000 },
        state: {},
      }),
    ).toBe(true);
  });

  it("allows toasts for foreground query failures without cached data", () => {
    expect(
      shouldSuppressQueryErrorToast({
        state: {},
      }),
    ).toBe(false);
  });
});
