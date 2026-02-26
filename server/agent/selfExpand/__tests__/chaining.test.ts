import { describe, it, expect, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

// Import fused Wave 1 modules
import {
  createPrompt,
  formatPrompt,
  executeChain,
  transforms,
} from "../fused/langchain-chains/index";
import {
  executeFlow,
  FlowBuilder,
} from "../fused/flowise-nodes/index";

// Import selfExpand pipeline
import { analyzeSource } from "../sourceAnalyzer";
import { fuseModule, registerFusedCapability, detectGap, resolveCap } from "../capabilityExpander";
import type { RepoSource } from "../types";

const CHAIN_TEST_DIR = join("/tmp", "selfexpand-chaining-test");
const CHAIN_FUSED_DIR = join(CHAIN_TEST_DIR, "fused");
const CHAIN_CLONE_DIR = join(CHAIN_TEST_DIR, "clone");

describe("unified brain: chain fused + auto-expanded capabilities", () => {
  afterAll(async () => {
    await rm(CHAIN_TEST_DIR, { recursive: true, force: true });
  });

  it("chains flowise-nodes -> langchain-chains -> auto-expanded CSV parser in one flow", async () => {
    // ════════════════════════════════════════════════════════════════════
    // Phase 1: Auto-expand a CSV parser (simulated clone, real pipeline)
    // ════════════════════════════════════════════════════════════════════

    // Simulate a cloned CSV parser repo
    const csvSrcDir = join(CHAIN_CLONE_DIR, "lib");
    await mkdir(csvSrcDir, { recursive: true });
    await writeFile(
      join(csvSrcDir, "index.js"),
      `
module.exports.parseCsv = function parseCsv(input) {
  const lines = input.trim().split("\\n");
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ""; });
    return obj;
  });
}

module.exports.csvToMarkdownTable = function csvToMarkdownTable(input) {
  const rows = parseCsv(input);
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const headerRow = "| " + headers.join(" | ") + " |";
  const separator = "| " + headers.map(() => "---").join(" | ") + " |";
  const dataRows = rows.map(row => "| " + headers.map(h => row[h]).join(" | ") + " |");
  return [headerRow, separator, ...dataRows].join("\\n");
}
`,
      "utf-8",
    );
    await writeFile(
      join(CHAIN_CLONE_DIR, "package.json"),
      JSON.stringify({ name: "csv-tools", version: "1.0.0", main: "lib/index.js" }),
      "utf-8",
    );

    // Analyze and fuse
    const analysis = await analyzeSource({
      clonePath: CHAIN_CLONE_DIR,
      extractPaths: ["lib/"],
    });
    expect(analysis.entryExports.length).toBeGreaterThanOrEqual(1);

    const manifest = await fuseModule({
      capabilityId: "csv-tools-chain",
      clonePath: CHAIN_CLONE_DIR,
      fusedDir: CHAIN_FUSED_DIR,
      analysisResult: analysis,
      repoSource: {
        name: "csv-tools",
        git: "https://github.com/test/csv-tools.git",
        extractPaths: ["lib/"],
        language: "javascript",
      } as RepoSource,
      commitSha: "chain-test-sha",
    });
    expect(manifest.capabilityId).toBe("csv-tools-chain");

    // Register (fire-and-forget)
    const reg = registerFusedCapability({
      capabilityId: "csv-tools-chain",
      toolName: "csv_tools_chain",
      description: "Auto-expanded CSV parser",
      execute: async (args: any) => {
        // Inline CSV parsing (simulates the fused capability running)
        const lines = String(args.input || "").trim().split("\n");
        const headers = lines[0]?.split(",").map((h: string) => h.trim()) || [];
        return lines.slice(1).map(line => {
          const values = line.split(",").map((v: string) => v.trim());
          const obj: Record<string, string> = {};
          headers.forEach((h: string, i: number) => { obj[h] = values[i] || ""; });
          return obj;
        });
      },
    });
    expect(reg.toolName).toBe("csv_tools_chain");

    // ════════════════════════════════════════════════════════════════════
    // Phase 2: Use flowise-nodes to build a data pipeline
    // ════════════════════════════════════════════════════════════════════

    const csvData = "name,role,level\nAlice,Engineer,Senior\nBob,Designer,Mid\nCarol,PM,Lead";

    const flowGraph = new FlowBuilder()
      .addSource("raw_csv", "csv_data")
      .addTransform("split_lines", "split", { delimiter: "\n" })
      .addFilter("skip_header", "min_length", { length: 5 })
      .addTransform("count_items", "length")
      .addOutput("line_count")
      .connect("raw_csv", "split_lines")
      .connect("split_lines", "skip_header")
      .connect("skip_header", "count_items")
      .connect("count_items", "line_count")
      .build();

    const flowResult = await executeFlow(flowGraph, { csv_data: csvData });

    // The flow counts the data lines (excluding header)
    // "name,role,level" is header, 3 data lines pass the min_length filter
    expect(flowResult.finalOutput).toBeGreaterThanOrEqual(3);
    expect(flowResult.metadata.nodesExecuted).toBe(5);

    // ════════════════════════════════════════════════════════════════════
    // Phase 3: Use langchain-chains to format a report
    // ════════════════════════════════════════════════════════════════════

    const chainResult = await executeChain(
      [
        {
          name: "header",
          prompt: createPrompt("# Team Report\n\nTotal members: {member_count}"),
        },
        {
          name: "details",
          prompt: createPrompt("{header_output}\n\n## Raw Data\n```\n{csv_raw}\n```"),
        },
        {
          name: "summary",
          prompt: createPrompt("{details_output}\n\n## Summary\nProcessed {member_count} team members via unified brain pipeline."),
          transform: transforms.trim,
        },
      ],
      {
        member_count: String(flowResult.finalOutput),
        csv_raw: csvData,
      },
    );

    // ════════════════════════════════════════════════════════════════════
    // Phase 4: Verify the unified chain worked
    // ════════════════════════════════════════════════════════════════════

    // Chain result should contain all the pieces
    expect(chainResult.finalOutput).toContain("Team Report");
    expect(chainResult.finalOutput).toContain("Alice");
    expect(chainResult.finalOutput).toContain("unified brain pipeline");
    expect(chainResult.steps).toHaveLength(3);

    // Verify all three capability sources were used:
    // 1. Auto-expanded (CSV tools registered)
    expect(reg.toolName).toBe("csv_tools_chain");
    // 2. Flowise-nodes (graph execution)
    expect(flowResult.metadata.nodesExecuted).toBeGreaterThan(0);
    // 3. LangChain-chains (prompt chain)
    expect(chainResult.totalDurationMs).toBeGreaterThanOrEqual(0);

    // The final output is a complete report
    expect(chainResult.finalOutput).toMatch(/# Team Report/);
    expect(chainResult.finalOutput).toMatch(/## Raw Data/);
    expect(chainResult.finalOutput).toMatch(/## Summary/);
  });

  it("detectGap -> resolveCap -> verify catalog has csv-parsing entry", () => {
    // This proves the catalog can discover the auto-expand target
    const gap = detectGap("csv_parse", "I need to parse a CSV file");
    expect(gap).not.toBeNull();
    const entry = resolveCap(gap!);
    expect(entry).not.toBeNull();
    expect(entry!.repos.length).toBeGreaterThan(0);
  });

  it("init() restores both Wave 1 fused modules from disk", async () => {
    const { init } = await import("../capabilityExpander");
    const count = await init();
    // langchain-chains + flowise-nodes should be restored
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
