import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolRegistry } from "../toolRegistry";

describe("ToolRegistry fetch_url inference", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("<html><title>Example</title><body>Hello world</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("infers the target url from dependency results when fetch_url receives no explicit url", async () => {
    const result = await toolRegistry.execute(
      "fetch_url",
      {
        _dependencyResults: {
          step_1: {
            output: {
              results: [{ title: "Example", url: "https://example.com/article" }],
            },
          },
        },
      },
      { userId: "test-user", runId: "run-1" } as any,
    );

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining("text/html"),
        }),
      }),
    );
    expect((result.output as any)?.url).toBe("https://example.com/article");
  });
});
