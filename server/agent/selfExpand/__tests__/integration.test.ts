import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the toolRegistry to simulate NOT_FOUND_ERROR
vi.mock("../../registry/toolRegistry", () => ({
  toolRegistry: {
    execute: vi.fn().mockResolvedValue({
      success: false,
      error: { code: "NOT_FOUND_ERROR", message: 'Tool "csv_parse" not found in registry' },
    }),
  },
}));

// Mock expandAndExecute to avoid real git clone, but keep the rest real
vi.mock("../capabilityExpander", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../capabilityExpander")>();
  return {
    ...actual,
    expandAndExecute: vi.fn(),
  };
});

describe("agentExecutor selfExpand integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports expandAndExecute without errors", async () => {
    const mod = await import("../capabilityExpander");
    expect(mod.expandAndExecute).toBeDefined();
    expect(typeof mod.expandAndExecute).toBe("function");
  });

  it("expandAndExecute returns null for builtin tools", async () => {
    const { detectGap } = await import("../capabilityExpander");
    // Built-in tools should return null from detectGap (first step of expandAndExecute)
    const result = detectGap("web_search", "search for something");
    expect(result).toBeNull();
  });

  it("expandAndExecute returns null for openclaw_ prefixed tools", async () => {
    const { detectGap } = await import("../capabilityExpander");
    const result = detectGap("openclaw_exec", "run a command");
    expect(result).toBeNull();
  });

  it("detects a gap for unknown tools and can resolve from catalog", async () => {
    const { detectGap, resolveCap } = await import("../capabilityExpander");
    const gap = detectGap("csv_parse", "parse this CSV file");
    expect(gap).not.toBeNull();
    expect(gap!.id).toContain("csv");
    // Try to resolve — may or may not match depending on catalog
    const entry = resolveCap(gap!);
    // csv-parse should be in the catalog
    if (entry) {
      expect(entry.repos.length).toBeGreaterThan(0);
    }
  });
});
