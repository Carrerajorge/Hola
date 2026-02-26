import { describe, it, expect, afterAll } from "vitest";
import { rm, readFile, access } from "fs/promises";
import { join } from "path";
import { detectGap, resolveCap, cloneRepo, fuseModule } from "../capabilityExpander";
import { analyzeSource } from "../sourceAnalyzer";
import type { RepoSource } from "../types";

const FUSED_TEST_DIR = join("/tmp", "selfexpand-real-expansion-fused");

// Skip unless SELFEXPAND_REAL_TEST=1 is set (requires network)
describe.skipIf(!process.env.SELFEXPAND_REAL_TEST)(
  "selfExpand REAL auto-expansion (network required)",
  () => {
    let clonePath: string;
    let commitSha: string;

    afterAll(async () => {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => {});
      await rm(FUSED_TEST_DIR, { recursive: true, force: true }).catch(() => {});
    });

    it("1. detects gap for markdown_to_html tool", () => {
      const gap = detectGap("markdown_to_html", "convert this markdown to HTML for me");
      expect(gap).not.toBeNull();
      expect(gap!.keywords).toEqual(expect.arrayContaining(["markdown"]));
    });

    it("2. resolves catalog entry for markdown-html", () => {
      const gap = detectGap("markdown_to_html", "convert markdown to HTML document");
      const entry = resolveCap(gap!);
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe("markdown-html");
      expect(entry!.repos[0].git).toContain("marked");
    });

    it("3. clones the real marked repo from GitHub", async () => {
      const result = await cloneRepo("https://github.com/markedjs/marked.git", "marked");
      clonePath = result.path;
      commitSha = result.commitSha;
      expect(clonePath).toBeTruthy();
      expect(commitSha).toMatch(/^[a-f0-9]+$/);
      // Verify the clone exists
      await access(clonePath);
    }, 60000); // 60s timeout for network

    it("4. analyzes the cloned source", async () => {
      const analysis = await analyzeSource({
        clonePath,
        extractPaths: ["lib/", "src/"],
      });
      expect(analysis.entryExports.length).toBeGreaterThan(0);
      expect(analysis.totalLines).toBeGreaterThan(0);
      // marked is TypeScript in src/ (may also have JS in lib/)
      expect(["javascript", "typescript"]).toContain(analysis.language);
    });

    it("5. fuses the analyzed source into a module", async () => {
      const analysis = await analyzeSource({
        clonePath,
        extractPaths: ["lib/", "src/"],
      });

      const repo: RepoSource = {
        name: "marked",
        git: "https://github.com/markedjs/marked.git",
        extractPaths: ["lib/", "src/"],
        language: "javascript",
      };

      const manifest = await fuseModule({
        capabilityId: "markdown-html-real",
        clonePath,
        fusedDir: FUSED_TEST_DIR,
        analysisResult: analysis,
        repoSource: repo,
        commitSha,
      });

      expect(manifest.capabilityId).toBe("markdown-html-real");
      expect(manifest.sourceName).toBe("marked");
      expect(manifest.totalPortedLines).toBeGreaterThan(0);

      // Verify files on disk
      const indexContent = await readFile(
        join(FUSED_TEST_DIR, "markdown-html-real", "index.ts"),
        "utf-8",
      );
      expect(indexContent.length).toBeGreaterThan(100);
      expect(indexContent).toContain("marked");
    });
  },
);
