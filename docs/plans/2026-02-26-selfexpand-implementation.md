# selfExpand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the selfExpand module that lets the agent autonomously detect missing capabilities, clone open-source repos, analyze their source via AST, port to TypeScript, fuse into the monolith, and register as native in-process tools — all with zero external HTTP APIs.

**Architecture:** Single orchestrator (`capabilityExpander.ts`) + AST analyzer (`sourceAnalyzer.ts`) + pre-indexed catalog (`catalog.json`). Fused code lives in `selfExpand/fused/[name]/`. Each fused capability dual-registers in both `CapabilityRegistry` (typed Zod schema) and `toolRegistry` (Gemini function calling). Integration hooks into `executeToolCall()` default case at line 294 of `agentExecutor.ts` and `initializeOpenClaw()` at line 302 of `server/index.ts`.

**Tech Stack:** TypeScript, Node.js `child_process.execFile` (for `git clone` — NOT exec, to prevent shell injection), `fs/promises`, `zod`, existing `toolRegistry` + `CapabilityRegistry` patterns.

**Design doc:** `docs/plans/2026-02-26-selfexpand-design.md`

**Security note:** All shell operations use `execFile` (not `exec`/`execSync`) to prevent command injection. Git URLs from catalog.json are validated before use. No user-supplied strings are interpolated into shell commands.

---

## Task 1: Interfaces & Types

**Files:**
- Create: `server/agent/selfExpand/types.ts`
- Test: `server/agent/selfExpand/__tests__/types.test.ts`

**Step 1: Write the failing test**

```typescript
// server/agent/selfExpand/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import {
  MissingCapabilitySchema,
  CatalogEntrySchema,
  RepoSourceSchema,
  FusedManifestSchema,
  AnalysisResultSchema,
  ExportedSymbolSchema,
} from "../types";

describe("selfExpand types", () => {
  it("validates a MissingCapability", () => {
    const cap = MissingCapabilitySchema.parse({
      id: "pdf-parsing",
      keywords: ["pdf", "parse"],
      toolNameAttempted: "pdf_parse",
      userMessage: "extract text from this PDF",
      confidence: 0.9,
    });
    expect(cap.id).toBe("pdf-parsing");
    expect(cap.confidence).toBeGreaterThan(0);
  });

  it("validates a CatalogEntry with repos", () => {
    const entry = CatalogEntrySchema.parse({
      id: "pdf-parsing",
      tags: ["pdf", "parse", "document"],
      repos: [
        {
          name: "pdf-parse",
          git: "https://github.com/user/pdf-parse.git",
          extractPaths: ["lib/"],
          language: "javascript",
        },
      ],
    });
    expect(entry.repos).toHaveLength(1);
    expect(entry.repos[0].language).toBe("javascript");
  });

  it("validates a FusedManifest", () => {
    const manifest = FusedManifestSchema.parse({
      capabilityId: "pdf-parsing",
      sourceName: "pdf-parse",
      sourceGit: "https://github.com/user/pdf-parse.git",
      sourceCommitSha: "abc123",
      extractedFiles: ["lib/index.js"],
      portStrategy: "transpile-js",
      fusedAt: new Date().toISOString(),
      registeredTools: ["pdf_parse"],
      totalPortedLines: 120,
    });
    expect(manifest.registeredTools).toContain("pdf_parse");
  });

  it("validates an AnalysisResult", () => {
    const result = AnalysisResultSchema.parse({
      entryExports: [
        {
          name: "parsePdf",
          kind: "function",
          signature: "(buffer: Buffer) => Promise<PdfData>",
          sourceFile: "lib/index.js",
          lineStart: 10,
          lineEnd: 45,
          body: "function parsePdf(buffer) { ... }",
        },
      ],
      dependencies: [],
      hasNativeBindings: false,
      totalLines: 120,
      language: "javascript",
      suggestedPortStrategy: "transpile-js",
    });
    expect(result.entryExports).toHaveLength(1);
    expect(result.suggestedPortStrategy).toBe("transpile-js");
  });

  it("rejects invalid confidence (> 1)", () => {
    expect(() =>
      MissingCapabilitySchema.parse({
        id: "x",
        keywords: [],
        userMessage: "test",
        confidence: 1.5,
      })
    ).toThrow();
  });

  it("rejects unknown language in RepoSource", () => {
    expect(() =>
      RepoSourceSchema.parse({
        name: "x",
        git: "https://github.com/x.git",
        extractPaths: [],
        language: "ruby",
      })
    ).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/selfExpand/__tests__/types.test.ts`
Expected: FAIL — module `../types` does not exist

**Step 3: Write the implementation**

```typescript
// server/agent/selfExpand/types.ts
import { z } from "zod";

// ── Missing Capability (what the agent needs) ──
export const MissingCapabilitySchema = z.object({
  id: z.string().min(1),
  keywords: z.array(z.string()),
  toolNameAttempted: z.string().optional(),
  userMessage: z.string(),
  confidence: z.number().min(0).max(1),
});
export type MissingCapability = z.infer<typeof MissingCapabilitySchema>;

// ── Repo Source (where to find the code) ──
export const RepoSourceSchema = z.object({
  name: z.string().min(1),
  git: z.string().url(),
  extractPaths: z.array(z.string()),
  language: z.enum(["typescript", "javascript", "python"]),
  entryPoint: z.string().optional(),
  nativeBindings: z.boolean().optional().default(false),
});
export type RepoSource = z.infer<typeof RepoSourceSchema>;

// ── Catalog Entry ──
export const CatalogEntrySchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()),
  repos: z.array(RepoSourceSchema).min(1),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

// ── Catalog (full JSON structure) ──
export const CatalogSchema = z.object({
  version: z.string().default("1.0.0"),
  capabilities: z.array(CatalogEntrySchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;

// ── Exported Symbol (what AST analysis finds) ──
export const ExportedSymbolSchema = z.object({
  name: z.string(),
  kind: z.enum(["function", "class", "constant"]),
  signature: z.string(),
  sourceFile: z.string(),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  body: z.string(),
});
export type ExportedSymbol = z.infer<typeof ExportedSymbolSchema>;

// ── Analysis Result ──
export const AnalysisResultSchema = z.object({
  entryExports: z.array(ExportedSymbolSchema),
  dependencies: z.array(z.string()),
  hasNativeBindings: z.boolean(),
  totalLines: z.number().int().nonnegative(),
  language: z.enum(["typescript", "javascript", "python"]),
  suggestedPortStrategy: z.enum([
    "direct-copy",
    "transpile-js",
    "port-python",
    "native-binding",
  ]),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ── Fused Manifest (provenance metadata) ──
export const FusedManifestSchema = z.object({
  capabilityId: z.string(),
  sourceName: z.string(),
  sourceGit: z.string(),
  sourceCommitSha: z.string(),
  extractedFiles: z.array(z.string()),
  portStrategy: z.string(),
  fusedAt: z.string(),
  registeredTools: z.array(z.string()),
  totalPortedLines: z.number().int().nonnegative(),
});
export type FusedManifest = z.infer<typeof FusedManifestSchema>;

// ── Safety Limits ──
export const SELF_EXPAND_LIMITS = {
  MAX_CLONE_SIZE_MB: 50,
  MAX_FILES_TO_ANALYZE: 50,
  MAX_LINES_PER_FILE: 2000,
  MAX_TOTAL_PORTED_LINES: 5000,
  CLONE_TIMEOUT_MS: 30_000,
  ANALYSIS_TIMEOUT_MS: 10_000,
  FUSION_TIMEOUT_MS: 10_000,
  TOTAL_TIMEOUT_MS: 60_000,
  TEMP_DIR: "/tmp/selfexpand",
} as const;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/selfExpand/__tests__/types.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add server/agent/selfExpand/types.ts server/agent/selfExpand/__tests__/types.test.ts
git commit -m "feat(selfExpand): add Zod types and schemas for capability expansion"
```

---

## Task 2: Capability Catalog (catalog.json)

**Files:**
- Create: `server/agent/selfExpand/catalog.json`
- Test: `server/agent/selfExpand/__tests__/catalog.test.ts`

**Step 1: Write the failing test**

```typescript
// server/agent/selfExpand/__tests__/catalog.test.ts
import { describe, it, expect } from "vitest";
import { CatalogSchema } from "../types";
import catalogData from "../catalog.json";

describe("selfExpand catalog", () => {
  it("validates against CatalogSchema", () => {
    const parsed = CatalogSchema.parse(catalogData);
    expect(parsed.capabilities.length).toBeGreaterThanOrEqual(10);
  });

  it("every entry has at least one repo", () => {
    const catalog = CatalogSchema.parse(catalogData);
    for (const entry of catalog.capabilities) {
      expect(entry.repos.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all repo git URLs end with .git", () => {
    const catalog = CatalogSchema.parse(catalogData);
    for (const entry of catalog.capabilities) {
      for (const repo of entry.repos) {
        expect(repo.git).toMatch(/\.git$/);
      }
    }
  });

  it("no duplicate capability IDs", () => {
    const catalog = CatalogSchema.parse(catalogData);
    const ids = catalog.capabilities.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has document processing capabilities", () => {
    const catalog = CatalogSchema.parse(catalogData);
    const docCaps = catalog.capabilities.filter((c) =>
      c.tags.some((t) => ["pdf", "docx", "xlsx", "csv"].includes(t))
    );
    expect(docCaps.length).toBeGreaterThanOrEqual(3);
  });

  it("has image processing capabilities", () => {
    const catalog = CatalogSchema.parse(catalogData);
    const imgCaps = catalog.capabilities.filter((c) =>
      c.tags.some((t) => ["image", "resize", "sharp", "vision"].includes(t))
    );
    expect(imgCaps.length).toBeGreaterThanOrEqual(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/selfExpand/__tests__/catalog.test.ts`
Expected: FAIL — cannot import `../catalog.json`

**Step 3: Write the catalog**

Create `server/agent/selfExpand/catalog.json` with ~25 curated entries across 11 domains. Each entry has: `id`, `tags` (for keyword matching), and `repos[]` (ordered by preference) with `name`, `git` URL, `extractPaths`, `language`, and optional `nativeBindings`.

Domains to cover:
- **document:** pdf-parse, mammoth (docx to html), xlsx/sheetjs, csv-parse
- **image:** sharp (native), jimp (pure JS), pica (pure JS resize)
- **scraping:** cheerio (DOM parse), turndown (html to md)
- **crypto:** crypto-js, bcryptjs, jose (JWT)
- **compression:** adm-zip, tar-stream, archiver
- **nlp:** compromise, natural, wink-nlp
- **data:** lodash, date-fns, mathjs
- **markdown:** marked, remark, markdown-it
- **yaml:** js-yaml, yaml
- **template:** handlebars, mustache, ejs
- **validation:** validator, email-validator

Each repo's `extractPaths` should point to the main source directory (e.g. `["lib/"]`, `["src/"]`). Mark `nativeBindings: true` for sharp, better-sqlite3, etc.

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/selfExpand/__tests__/catalog.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add server/agent/selfExpand/catalog.json server/agent/selfExpand/__tests__/catalog.test.ts
git commit -m "feat(selfExpand): add curated capability catalog with 25 entries"
```

---

## Task 3: Source Analyzer (regex-based export extraction)

**Files:**
- Create: `server/agent/selfExpand/sourceAnalyzer.ts`
- Test: `server/agent/selfExpand/__tests__/sourceAnalyzer.test.ts`

**Step 1: Write the failing test**

```typescript
// server/agent/selfExpand/__tests__/sourceAnalyzer.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyzeSource } from "../sourceAnalyzer";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_DIR = "/tmp/selfexpand-test-analyzer";

beforeAll(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("sourceAnalyzer", () => {
  it("extracts exported functions from a JS file", async () => {
    await writeFile(
      join(TEST_DIR, "src/index.js"),
      `
module.exports = function parsePdf(buffer) {
  return { text: buffer.toString() };
};

module.exports.version = "1.0.0";
`.trim()
    );

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/"],
    });

    expect(result.language).toBe("javascript");
    expect(result.suggestedPortStrategy).toBe("transpile-js");
    expect(result.entryExports.length).toBeGreaterThanOrEqual(1);
    expect(result.entryExports[0].name).toBe("parsePdf");
    expect(result.entryExports[0].kind).toBe("function");
  });

  it("extracts exported functions from a TS file", async () => {
    await writeFile(
      join(TEST_DIR, "src/util.ts"),
      `
export function compress(data: Buffer): Buffer {
  return data;
}

export class Compressor {
  run(input: string): string {
    return input;
  }
}
`.trim()
    );

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/util.ts"],
    });

    expect(result.language).toBe("typescript");
    expect(result.suggestedPortStrategy).toBe("direct-copy");
    const names = result.entryExports.map((e) => e.name);
    expect(names).toContain("compress");
    expect(names).toContain("Compressor");
  });

  it("detects native bindings from package.json", async () => {
    await writeFile(
      join(TEST_DIR, "package.json"),
      JSON.stringify({
        name: "native-pkg",
        dependencies: { "node-gyp": "^9.0.0" },
        scripts: { install: "node-gyp rebuild" },
      })
    );

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/"],
    });

    expect(result.hasNativeBindings).toBe(true);
  });

  it("respects maxFiles limit", async () => {
    const bigDir = join(TEST_DIR, "many");
    await mkdir(bigDir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      await writeFile(join(bigDir, `f${i}.js`), `module.exports = ${i};`);
    }

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["many/"],
      maxFiles: 50,
    });

    expect(result.totalLines).toBeLessThanOrEqual(60);
  });

  it("returns empty exports for non-code files", async () => {
    await writeFile(join(TEST_DIR, "src/readme.md"), "# Hello");

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/readme.md"],
    });

    expect(result.entryExports).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/selfExpand/__tests__/sourceAnalyzer.test.ts`
Expected: FAIL — module `../sourceAnalyzer` does not exist

**Step 3: Write the implementation**

`sourceAnalyzer.ts` (~200-300 lines). Uses ONLY `fs/promises` and regex (zero external dependencies).

**Key behavior:**
1. **Walk `extractPaths`** — recursively find `.ts`, `.js`, `.mjs`, `.cjs` files up to `maxFiles` limit
2. **Read each file** — respect `MAX_LINES_PER_FILE` (2000 lines), skip binaries
3. **Parse exports** via regex:
   - ES modules: `export function NAME(`, `export class NAME`, `export const NAME`
   - CJS: `module.exports = function NAME(`, `module.exports.NAME`, `exports.NAME`
   - Default exports: `export default`
4. **Extract function/class bodies** — track brace depth `{` / `}` to find boundaries
5. **Detect language** — `.ts` files present → typescript, else javascript (or python for `.py`)
6. **Detect native bindings** — check `package.json` for: `node-gyp`, `prebuild`, `nan`, `napi`, `binding.gyp` in deps/scripts
7. **Suggest port strategy** — `direct-copy` for TS, `transpile-js` for JS, `native-binding` if native detected
8. **Return `AnalysisResult`**

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/selfExpand/__tests__/sourceAnalyzer.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add server/agent/selfExpand/sourceAnalyzer.ts server/agent/selfExpand/__tests__/sourceAnalyzer.test.ts
git commit -m "feat(selfExpand): add source analyzer with regex-based export extraction"
```

---

## Task 4: Capability Expander (Orchestrator)

**Files:**
- Create: `server/agent/selfExpand/capabilityExpander.ts`
- Create: `server/agent/selfExpand/fused/.gitkeep`
- Test: `server/agent/selfExpand/__tests__/capabilityExpander.test.ts`

**Step 1: Write the failing test**

```typescript
// server/agent/selfExpand/__tests__/capabilityExpander.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/selfExpand/__tests__/capabilityExpander.test.ts`
Expected: FAIL — module `../capabilityExpander` does not exist

**Step 3: Write the implementation**

`capabilityExpander.ts` (~400-500 lines) — the orchestrator.

**Exported functions:**

1. **`detectGap(toolName, userMessage): MissingCapability | null`**
   - Skip known builtins: `web_search`, `fetch_url`, `read_file`, `write_file`, `list_files`, `browse_and_act`, `create_document`, `create_presentation`, `create_spreadsheet`, `generate_chart`, `analyze_data`, `memory_search`, any `openclaw_*` tool
   - Extract keywords from `toolName` (split on `_`) + from `userMessage` (split words, filter stopwords, keep >3 chars)
   - Build `MissingCapability` with deduplicated keywords

2. **`resolveCap(missing): CatalogEntry | null`**
   - Load `catalog.json` (cached in-memory)
   - Score: count keyword matches between `missing.keywords` and `entry.tags`
   - Return highest-scoring if score >= 2, else null

3. **`cloneRepo(gitUrl, name): Promise<{ path, commitSha }>`**
   - Uses `execFile('git', ['clone', '--depth', '1', url, targetPath])` — NOT exec/execSync
   - Timeout: 30s. Target: `/tmp/selfexpand/<name>-<timestamp>`
   - Get SHA: `execFile('git', ['rev-parse', 'HEAD'], { cwd })`
   - Verify size < 50MB: `execFile('du', ['-sm', path])`
   - Validate URL format before cloning (must be `https://` and end with `.git`)

4. **`fuseModule(opts): Promise<FusedManifest>`**
   - `direct-copy`: Copy extracted bodies to `fused/<id>/index.ts` as barrel
   - `transpile-js`: Copy JS, create TS wrapper with `any` types
   - `native-binding`: Check `node_modules/<name>` → thin re-export wrapper or throw
   - Write `manifest.json`
   - Cleanup clone dir

5. **`registerFusedCapability(opts): FusedCapabilityRegistration`**
   - Register in `CapabilityRegistry` with auto Zod schema
   - Register in `toolRegistry` as RegisteredTool (category: `"Utility"`)
   - Return registration object

6. **`expandAndExecute(toolName, args, context, runId, sseRes?): Promise<{result} | null>`**
   - Main entry point from agentExecutor
   - Full cycle: detect → resolve → clone → analyze → fuse → register → execute → return
   - Emits SSE: `capability_expanding`, `capability_acquired` / `capability_failed`
   - 60-second total timeout. Returns null on any failure.

7. **`init(): Promise<number>`**
   - Scan `fused/` for `manifest.json` files
   - Dynamic import each `fused/<name>/index.ts`
   - Re-register in both registries
   - Return count of restored capabilities

**Key imports:**
```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, writeFile, mkdir, rm, stat } from "fs/promises";
import { join, resolve, dirname } from "path";
import { z } from "zod";
import { toolRegistry } from "../registry/toolRegistry";
import { capabilityRegistry } from "../capabilities/registry";
import { analyzeSource } from "./sourceAnalyzer";
import catalogData from "./catalog.json";
import type { MissingCapability, CatalogEntry, FusedManifest, AnalysisResult, RepoSource } from "./types";
import { SELF_EXPAND_LIMITS } from "./types";

const execFileAsync = promisify(execFile);
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/selfExpand/__tests__/capabilityExpander.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add server/agent/selfExpand/capabilityExpander.ts server/agent/selfExpand/fused/.gitkeep server/agent/selfExpand/__tests__/capabilityExpander.test.ts
git commit -m "feat(selfExpand): add capability expander orchestrator with full fusion cycle"
```

---

## Task 5: Integration into agentExecutor.ts

**Files:**
- Modify: `server/agent/agentExecutor.ts:294-297` (default case in executeToolCall)
- Modify: `server/agent/agentExecutor.ts:1-9` (imports)
- Test: `server/agent/selfExpand/__tests__/integration.test.ts`

**Step 1: Write the failing test**

```typescript
// server/agent/selfExpand/__tests__/integration.test.ts
import { describe, it, expect } from "vitest";

describe("selfExpand integration with agentExecutor", () => {
  it("agentExecutor imports capabilityExpander without error", async () => {
    const mod = await import("../capabilityExpander");
    expect(mod.expandAndExecute).toBeDefined();
    expect(mod.detectGap).toBeDefined();
    expect(mod.init).toBeDefined();
  });

  it("expandAndExecute returns null for known builtins", async () => {
    const { expandAndExecute } = await import("../capabilityExpander");
    const result = await expandAndExecute(
      "web_search",
      { query: "test" },
      { userId: "test", chatId: "test", runId: "test" },
      "run-123",
      undefined
    );
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it passes** (depends on Task 4)

Run: `npx vitest run server/agent/selfExpand/__tests__/integration.test.ts`
Expected: PASS

**Step 3: Modify agentExecutor.ts**

Add import after line 9:
```typescript
import { expandAndExecute } from './selfExpand/capabilityExpander';
```

Replace the default case at lines 294-297. Current code:
```typescript
      default: {
        const toolResult = await toolRegistry.execute(toolName, args, context);
        result = toolResult.success ? toolResult.output : { error: toolResult.error?.message };
      }
```

New code:
```typescript
      default: {
        const toolResult = await toolRegistry.execute(toolName, args, context);
        if (toolResult.success) {
          result = toolResult.output;
        } else if (toolResult.error?.code === "NOT_FOUND_ERROR") {
          // selfExpand: attempt autonomous capability expansion
          const expanded = await expandAndExecute(
            toolName, args, context, runId, sseRes
          );
          if (expanded) {
            result = expanded.result;
            if (expanded.artifact) artifact = expanded.artifact;
          } else {
            result = { error: toolResult.error?.message };
          }
        } else {
          result = { error: toolResult.error?.message };
        }
      }
```

**Step 4: Verify syntax**

Run: `npx esbuild server/agent/agentExecutor.ts --bundle --platform=node --outfile=/dev/null --external:* 2>&1 | head -5`
Expected: 0 errors

**Step 5: Commit**

```bash
git add server/agent/agentExecutor.ts server/agent/selfExpand/__tests__/integration.test.ts
git commit -m "feat(selfExpand): wire expansion into agentExecutor default tool path"
```

---

## Task 6: Integration into server startup

**Files:**
- Modify: `server/openclaw/index.ts:28-32` (after skills init)

**Step 1: Modify initializeOpenClaw**

After the skills initialization block (line 32), add:

```typescript
  // selfExpand: restore previously fused capabilities from disk
  try {
    const { init: initSelfExpand } = await import('../agent/selfExpand/capabilityExpander');
    const restoredCount = await initSelfExpand();
    if (restoredCount > 0) {
      enabledModules.push(`selfExpand(${restoredCount})`);
    }
  } catch (err) {
    Logger.warn(`[SelfExpand] Failed to initialize: ${(err as Error).message}`);
  }
```

**Step 2: Verify syntax**

Run: `npx esbuild server/openclaw/index.ts --bundle --platform=node --outfile=/dev/null --external:* 2>&1 | head -5`
Expected: 0 errors

**Step 3: Commit**

```bash
git add server/openclaw/index.ts
git commit -m "feat(selfExpand): restore fused capabilities on server startup"
```

---

## Task 7: End-to-End Test

**Files:**
- Create: `server/agent/selfExpand/__tests__/e2e.test.ts`

**Step 1: Write the E2E test**

```typescript
// server/agent/selfExpand/__tests__/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm, readdir } from "fs/promises";
import { join } from "path";

const TEST_FUSED_DIR = "/tmp/selfexpand-e2e-fused";
const TEST_CLONE_DIR = "/tmp/selfexpand-e2e-clone";

describe("selfExpand E2E", () => {
  beforeAll(async () => {
    await mkdir(TEST_FUSED_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_FUSED_DIR, { recursive: true, force: true });
    await rm(TEST_CLONE_DIR, { recursive: true, force: true });
  });

  it("full cycle: detect -> resolve -> analyze -> fuse -> register", async () => {
    const { detectGap, resolveCap, fuseModule, registerFusedCapability } = await import(
      "../capabilityExpander"
    );
    const { analyzeSource } = await import("../sourceAnalyzer");

    // 1. Detect gap
    const gap = detectGap("csv_parse", "parse this CSV file and extract the data");
    expect(gap).not.toBeNull();
    expect(gap!.keywords).toContain("csv");

    // 2. Resolve from catalog
    const entry = resolveCap(gap!);
    expect(entry).not.toBeNull();

    // 3. Simulate clone with local fixture
    await mkdir(join(TEST_CLONE_DIR, "lib"), { recursive: true });
    await writeFile(
      join(TEST_CLONE_DIR, "lib/index.js"),
      `
function parseCsv(text, options) {
  const lines = text.split('\\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h.trim(), values[i]?.trim()]));
  });
}

module.exports = parseCsv;
module.exports.parseCsv = parseCsv;
`.trim()
    );
    await writeFile(
      join(TEST_CLONE_DIR, "package.json"),
      JSON.stringify({ name: "csv-parse", version: "1.0.0" })
    );

    // 4. Analyze
    const analysis = await analyzeSource({
      clonePath: TEST_CLONE_DIR,
      extractPaths: ["lib/"],
    });
    expect(analysis.language).toBe("javascript");
    expect(analysis.suggestedPortStrategy).toBe("transpile-js");
    expect(analysis.entryExports.length).toBeGreaterThanOrEqual(1);

    // 5. Fuse
    const manifest = await fuseModule({
      capabilityId: "csv-parsing",
      clonePath: TEST_CLONE_DIR,
      fusedDir: TEST_FUSED_DIR,
      analysisResult: analysis,
      repoSource: entry!.repos[0],
      commitSha: "e2e-test-sha",
    });
    expect(manifest.capabilityId).toBe("csv-parsing");

    // 6. Verify fused files exist
    const fusedFiles = await readdir(join(TEST_FUSED_DIR, "csv-parsing"));
    expect(fusedFiles).toContain("index.ts");
    expect(fusedFiles).toContain("manifest.json");

    // 7. Register
    const reg = registerFusedCapability({
      capabilityId: "csv-parsing",
      toolName: "csv_parse",
      description: "Parse CSV text into structured data",
      execute: async (args: any) => ({ rows: [{ col: "value" }] }),
    });
    expect(reg.toolName).toBe("csv_parse");
  });

  it("init runs without error and returns a number", async () => {
    const { init } = await import("../capabilityExpander");
    const count = await init();
    expect(typeof count).toBe("number");
  });
});
```

**Step 2: Run all selfExpand tests**

Run: `npx vitest run server/agent/selfExpand/`
Expected: ALL PASS (~24 tests across 5 test files)

**Step 3: Commit**

```bash
git add server/agent/selfExpand/__tests__/e2e.test.ts
git commit -m "test(selfExpand): add end-to-end test for full detect-fuse-register cycle"
```

---

## Task 8: Run full test suite & verify no regressions

**Step 1: Run all existing tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pre-existing tests pass (602+), all new selfExpand tests pass (~24)

**Step 2: Verify syntax of all modified files**

Run: `npx esbuild server/agent/agentExecutor.ts server/openclaw/index.ts server/agent/selfExpand/capabilityExpander.ts server/agent/selfExpand/sourceAnalyzer.ts server/agent/selfExpand/types.ts --bundle --platform=node --outfile=/dev/null --external:* 2>&1`
Expected: 0 errors

**Step 3: Final commit if any fixups needed**

```bash
git add -A && git commit -m "fix(selfExpand): address test feedback and fixups"
```

---

## Summary

| Task | Files | Tests | Description |
|------|-------|-------|-------------|
| 1 | types.ts | 6 | Zod schemas for all interfaces |
| 2 | catalog.json | 6 | Pre-indexed capability catalog |
| 3 | sourceAnalyzer.ts | 5 | Regex-based export extraction |
| 4 | capabilityExpander.ts | 5 | Orchestrator: detect-resolve-clone-fuse-register |
| 5 | agentExecutor.ts (mod) | 2 | Wire NOT_FOUND to expandAndExecute |
| 6 | openclaw/index.ts (mod) | 0 | Restore fused capabilities on startup |
| 7 | e2e.test.ts | 2 | Full cycle end-to-end test |
| 8 | - | ~26 total | Regression check |

**Total new files:** 7 (4 source + 1 JSON + 1 .gitkeep + 5 test files)
**Modified files:** 2 (agentExecutor.ts, openclaw/index.ts)
**Estimated new lines:** ~1200 (source) + ~350 (tests) + ~200 (catalog JSON)
