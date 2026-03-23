import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStoredAnonTokenMock, getStoredAnonUserIdMock } = vi.hoisted(() => ({
  getStoredAnonUserIdMock: vi.fn(),
  getStoredAnonTokenMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  getStoredAnonUserId: () => getStoredAnonUserIdMock(),
  getStoredAnonToken: () => getStoredAnonTokenMock(),
}));

import { apiFetch } from "@/lib/apiClient";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
    getStoredAnonUserIdMock.mockReset();
    getStoredAnonTokenMock.mockReset();
    getStoredAnonUserIdMock.mockReturnValue(null);
    getStoredAnonTokenMock.mockReturnValue(null);
    window.history.replaceState({}, "", "/settings");
    document.cookie = "XSRF-TOKEN=;";
  });

  it("does not retry alternate dev ports when the primary server returns 500", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response("server error", { status: 500 }),
    );

    const response = await apiFetch("/api/oauth/providers/status");

    expect(response.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("/api/oauth/providers/status", window.location.origin).toString(),
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  const maybeIt = import.meta.env.DEV ? it : it.skip;

  maybeIt("retries alternate dev ports after a network failure", async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await apiFetch("/api/oauth/providers/status");

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      `${window.location.protocol}//${window.location.hostname}:5000/api/oauth/providers/status`,
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });
});
