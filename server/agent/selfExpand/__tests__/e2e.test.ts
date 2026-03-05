import { describe, it, expect, afterAll } from "vitest";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { analyzeSource } from "../sourceAnalyzer";
import { detectGap, resolveCap, fuseModule, registerFusedCapability } from "../capabilityExpander";
import type { RepoSource } from "../types";

const TEST_CLONE_DIR = join("/tmp", "selfexpand-e2e-test-clone");
const TEST_FUSED_DIR = join("/tmp", "selfexpand-e2e-test-fused");

describe("selfExpand E2E: detect → analyze → fuse → register", () => {
  afterAll(async () => {
    await rm(TEST_CLONE_DIR, { recursive: true, force: true });
    await rm(TEST_FUSED_DIR, { recursive: true, force: true });
  });

  it("full cycle: fake clone → analyze → fuse → register", async () => {
    // ── Step 1: Simulate a cloned repo ──
    const srcDir = join(TEST_CLONE_DIR, "lib");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "index.js"),
      `
/**
 * Parses a CSV string into an array of objects.
 */
module.exports.parseCsv = function parseCsv(input) {
  const lines = input.trim().split("\\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const values = line.split(",");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = values[i]?.trim();
    });
    return obj;
  });
}

module.exports.formatCsv = function formatCsv(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => row[h]).join(","));
  return [headers.join(","), ...rows].join("\\n");
}
`,
      "utf-8",
    );
    await writeFile(
      join(TEST_CLONE_DIR, "package.json"),
      JSON.stringify({ name: "csv-utils", version: "1.0.0", main: "lib/index.js" }),
      "utf-8",
    );

    // ── Step 2: Detect a gap ──
    const gap = detectGap("csv_parse", "parse this CSV file for me");
    expect(gap).not.toBeNull();
    expect(gap!.keywords).toEqual(expect.arrayContaining(["csv", "parse"]));

    // ── Step 3: Analyze source ──
    const analysis = await analyzeSource({
      clonePath: TEST_CLONE_DIR,
      extractPaths: ["lib/"],
    });

    expect(analysis.entryExports.length).toBeGreaterThanOrEqual(1);
    expect(analysis.language).toBe("javascript");
    expect(analysis.hasNativeBindings).toBe(false);
    expect(analysis.suggestedPortStrategy).toBe("transpile-js");

    // Verify we found our functions
    const exportNames = analysis.entryExports.map((e) => e.name);
    expect(exportNames).toContain("parseCsv");
    expect(exportNames).toContain("formatCsv");

    // ── Step 4: Fuse module ──
    const fakeRepo: RepoSource = {
      name: "csv-utils",
      git: "https://github.com/test/csv-utils.git",
      extractPaths: ["lib/"],
      language: "javascript",
    };

    const manifest = await fuseModule({
      capabilityId: "csv-parse-e2e",
      clonePath: TEST_CLONE_DIR,
      fusedDir: TEST_FUSED_DIR,
      analysisResult: analysis,
      repoSource: fakeRepo,
      commitSha: "e2e-test-sha-000",
    });

    expect(manifest.capabilityId).toBe("csv-parse-e2e");
    expect(manifest.sourceName).toBe("csv-utils");
    expect(manifest.portStrategy).toBe("transpile-js");
    expect(manifest.totalPortedLines).toBeGreaterThan(0);

    // Verify files on disk
    const indexContent = await readFile(join(TEST_FUSED_DIR, "csv-parse-e2e", "index.ts"), "utf-8");
    expect(indexContent).toContain("csv-utils");
    expect(indexContent).toContain("parseCsv");

    const manifestOnDisk = JSON.parse(
      await readFile(join(TEST_FUSED_DIR, "csv-parse-e2e", "manifest.json"), "utf-8"),
    );
    expect(manifestOnDisk.capabilityId).toBe("csv-parse-e2e");
    expect(manifestOnDisk.sourceCommitSha).toBe("e2e-test-sha-000");

    // ── Step 5: Register (fire-and-forget, just verify it doesn't throw) ──
    const reg = registerFusedCapability({
      capabilityId: "csv-parse-e2e",
      toolName: "csv_parse_e2e",
      description: "E2E test: CSV parsing",
      execute: async (args: any) => ({ parsed: true }),
    });
    expect(reg.toolName).toBe("csv_parse_e2e");
  });

  it("detects gap and resolves catalog entry for csv-parse", () => {
    const gap = detectGap("csv_parse", "parse CSV data from a file");
    expect(gap).not.toBeNull();

    const entry = resolveCap(gap!);
    // csv-parsing should exist in the catalog
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("csv-parsing");
    expect(entry!.repos.length).toBeGreaterThan(0);
  });
});
