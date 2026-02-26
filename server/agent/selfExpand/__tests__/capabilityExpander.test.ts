import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";

const FUSED_DIR = "/tmp/selfexpand-test-fused";
const CLONE_DIR = "/tmp/selfexpand-test-clone";

describe("capabilityExpander", () => {
  beforeEach(async () => {
    await mkdir(FUSED_DIR, { recursive: true });
    await mkdir(join(CLONE_DIR, "lib"), { recursive: true });
  });

  afterEach(async () => {
    await rm(FUSED_DIR, { recursive: true, force: true });
    await rm(CLONE_DIR, { recursive: true, force: true });
  });

  describe("detectGap", () => {
    it("extracts keywords from a tool name", async () => {
      const { detectGap } = await import("../capabilityExpander");
      const gap = detectGap("pdf_parse", "extract text from my PDF file");
      expect(gap).not.toBeNull();
      expect(gap!.id).toContain("pdf");
      expect(gap!.keywords).toContain("pdf");
      expect(gap!.keywords).toContain("parse");
    });

    it("extracts keywords from user message when tool name is generic", async () => {
      const { detectGap } = await import("../capabilityExpander");
      const gap = detectGap("unknown_tool", "I need to compress images to webp format");
      expect(gap).not.toBeNull();
      expect(gap!.keywords.some((k) => ["image", "compress", "webp"].includes(k))).toBe(true);
    });

    it("returns null for known builtin tools", async () => {
      const { detectGap } = await import("../capabilityExpander");
      const gap = detectGap("web_search", "search the web");
      expect(gap).toBeNull();
    });
  });

  describe("resolveCap", () => {
    it("finds a catalog match for pdf-related keywords", async () => {
      const { resolveCap } = await import("../capabilityExpander");
      const match = resolveCap({
        id: "pdf-parsing",
        keywords: ["pdf", "parse", "text"],
        userMessage: "extract text from PDF",
        confidence: 0.9,
      });
      expect(match).not.toBeNull();
      expect(match!.repos.length).toBeGreaterThanOrEqual(1);
    });

    it("returns null for unmatchable keywords", async () => {
      const { resolveCap } = await import("../capabilityExpander");
      const match = resolveCap({
        id: "quantum-entanglement",
        keywords: ["quantum", "entanglement", "qubits"],
        userMessage: "simulate quantum entanglement",
        confidence: 0.5,
      });
      expect(match).toBeNull();
    });
  });

  describe("fuseModule", () => {
    it("copies TS source to fused directory and creates manifest", async () => {
      await writeFile(
        join(CLONE_DIR, "lib/index.ts"),
        'export function parsePdf(buf: Buffer): string { return buf.toString(); }'
      );

      const { fuseModule } = await import("../capabilityExpander");
      const manifest = await fuseModule({
        capabilityId: "pdf-parsing",
        clonePath: CLONE_DIR,
        fusedDir: FUSED_DIR,
        analysisResult: {
          entryExports: [
            {
              name: "parsePdf",
              kind: "function" as const,
              signature: "(buf: Buffer) => string",
              sourceFile: "lib/index.ts",
              lineStart: 0,
              lineEnd: 0,
              body: 'export function parsePdf(buf: Buffer): string { return buf.toString(); }',
            },
          ],
          dependencies: [],
          hasNativeBindings: false,
          totalLines: 1,
          language: "typescript" as const,
          suggestedPortStrategy: "direct-copy" as const,
        },
        repoSource: {
          name: "pdf-parse",
          git: "https://github.com/user/pdf-parse.git",
          extractPaths: ["lib/"],
          language: "typescript" as const,
        },
        commitSha: "abc123def",
      });

      expect(manifest.capabilityId).toBe("pdf-parsing");
      expect(manifest.portStrategy).toBe("direct-copy");

      const indexContent = await readFile(join(FUSED_DIR, "pdf-parsing/index.ts"), "utf-8");
      expect(indexContent).toContain("parsePdf");

      const manifestContent = JSON.parse(
        await readFile(join(FUSED_DIR, "pdf-parsing/manifest.json"), "utf-8")
      );
      expect(manifestContent.sourceCommitSha).toBe("abc123def");
    });
  });

  describe("registerFusedCapability", () => {
    it("registers without throwing and returns valid object", async () => {
      const { registerFusedCapability } = await import("../capabilityExpander");
      const reg = registerFusedCapability({
        capabilityId: "test-cap",
        toolName: "test_tool",
        description: "A test tool",
        execute: async (args: any) => ({ result: "ok" }),
      });
      expect(reg.toolName).toBe("test_tool");
    });
  });
});
