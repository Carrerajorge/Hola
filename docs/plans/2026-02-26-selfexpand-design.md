# selfExpand: Autonomous Capability Expansion via Source Fusion

**Date:** 2026-02-26
**Status:** Approved
**Author:** Claude (design), Luis (approval)

---

## 1. Purpose

The agent must self-discover and self-expand its capabilities at runtime. When it detects a missing capability, it finds open-source code, clones it, analyzes the source, extracts the modules it needs, ports them to TypeScript, fuses them directly into the monolith as native in-process code, and registers them in the CapabilityRegistry so the agent can invoke them immediately.

**Inviolable rule:** Every expansion is pure code fusion. No HTTP APIs. No Docker. No external services. No npm install. The only network operation allowed is `git clone --depth 1`. The fused code runs in the same Node.js process, sharing memory and state with the agent.

## 2. Architecture

### Data Flow

```
User request → agentExecutor → tool NOT_FOUND
  → capabilityExpander.expandAndExecute()
    1. detectGap()        → MissingCapability
    2. resolveCap()       → catalog.json lookup → CatalogEntry
    3. cloneRepo()        → git clone --depth 1 → /tmp/selfexpand/
    4. analyzeSource()    → sourceAnalyzer.ts → AnalysisResult
    5. fuseIntoMonolith() → port TS → write fused/[name]/
    6. registerCap()      → CapabilityRegistry + toolRegistry
    7. emit SSE           → capability_expanding → capability_acquired
    8. executeNow()       → run fused code → return result
  → result flows back → agentExecutor → SSE → user
```

### File Layout

```
server/agent/selfExpand/
├── capabilityExpander.ts      # Orchestrator (~400-500 lines)
├── sourceAnalyzer.ts          # AST extraction engine (~200-300 lines)
├── catalog.json               # Pre-indexed capability catalog (~50-200 entries)
└── fused/                     # Auto-generated ported capabilities
    ├── registry.json           # Index of all fused capabilities
    └── [capability-name]/
        ├── index.ts            # Ported entry point (pure TS, zero external deps)
        └── manifest.json       # Provenance: repo, SHA, files, timestamp
```

### Dual Registration

Each fused capability registers in:

1. **`server/agent/capabilities/registry.ts`** (`CapabilityRegistry`) — typed with Zod schema + execute function, so the planner discovers it as a native capability.
2. **`server/agent/toolRegistry.ts`** (or `registry/toolRegistry.ts`) — as a RegisteredTool so the Gemini agent loop can call it by name via function calling.

Physical code lives in `selfExpand/fused/` for auditability. Functional integration is via the two registries.

## 3. Interfaces

```typescript
// ── MissingCapability ──
interface MissingCapability {
  id: string;                    // "pdf-parsing"
  keywords: string[];            // ["pdf", "parse", "extract", "text"]
  toolNameAttempted?: string;    // "pdf_parse"
  userMessage: string;
  confidence: number;            // 0-1
}

// ── Catalog Entries ──
interface CatalogEntry {
  id: string;                    // "pdf-parsing"
  tags: string[];                // ["pdf", "parse", "document", "text"]
  repos: RepoSource[];           // Ordered by preference
}

interface RepoSource {
  name: string;                  // "pdf-parse"
  git: string;                   // "https://github.com/user/repo.git"
  extractPaths: string[];        // ["lib/", "src/index.js"]
  language: "typescript" | "javascript" | "python";
  entryPoint?: string;
  nativeBindings?: boolean;
}

// ── Analysis Result ──
interface AnalysisResult {
  entryExports: ExportedSymbol[];
  dependencies: string[];
  hasNativeBindings: boolean;
  totalLines: number;
  language: "typescript" | "javascript" | "python";
  suggestedPortStrategy: "direct-copy" | "transpile-js" | "port-python" | "native-binding";
}

interface ExportedSymbol {
  name: string;
  kind: "function" | "class" | "constant";
  signature: string;
  sourceFile: string;
  lineStart: number;
  lineEnd: number;
  body: string;
}

// ── Fused Manifest ──
interface FusedManifest {
  capabilityId: string;
  sourceName: string;
  sourceGit: string;
  sourceCommitSha: string;
  extractedFiles: string[];
  portStrategy: string;
  fusedAt: string;               // ISO timestamp
  registeredTools: string[];
  totalPortedLines: number;
}

// ── Registration ──
interface FusedCapabilityRegistration {
  toolName: string;
  description: string;
  zodSchema: z.ZodSchema<any>;
  execute: (args: any) => Promise<any>;
  manifest: FusedManifest;
}
```

## 4. Discovery: Hybrid Catalog + Git Clone

### Pre-Indexed Catalog (Fast Path)

`catalog.json` ships ~50 curated entries at launch, covering:

| Domain | Packages |
|--------|----------|
| document | pdf-parse, mammoth, xlsx, csv-parse |
| image | sharp, jimp, pica |
| scraping | cheerio, puppeteer-core, playwright-core |
| ml | transformers.js, onnxruntime-node, brain.js |
| crypto | crypto-js, bcryptjs, jose |
| data | lodash, date-fns |
| compression | archiver, adm-zip, tar-stream |
| audio | ffmpeg.wasm, tone.js |
| nlp | compromise, natural, wink-nlp |
| vision | tesseract.js |
| database | better-sqlite3, duckdb-node |

Catalog lookup is in-memory keyword matching: `MissingCapability.keywords` matched against `CatalogEntry.tags`.

### Git Clone Fallback (Slow Path)

When the catalog has no match, the agent reasons about what repo might help (using context from the user message) and attempts `git clone --depth 1`. The cloned repo is analyzed, fused, and the catalog is updated with the new entry for future lookups.

## 5. Fusion Strategies

| Strategy | When | How |
|----------|------|-----|
| `direct-copy` | Source is TypeScript | Copy files to `fused/`, done |
| `transpile-js` | Source is JavaScript | Add TS type annotations via inference, wrap with types |
| `port-python` | Source is Python | Rewrite in TypeScript (LLM-assisted if Gemini available, template-based offline) |
| `native-binding` | Package uses .node binaries | Check `node_modules` for existing install → thin wrapper if found → `capability_failed` if not |
| `npm-fallback` | Too complex to port | Check `node_modules` → thin wrapper if found → `capability_failed` with install suggestion |

## 6. SSE Events

```
capability_expanding  → { id, source, git }
capability_acquired   → { id, tools[], fusedModules, linesPorted }
capability_failed     → { id, reason, suggestion }
```

## 7. Safety Boundaries

| Limit | Value |
|-------|-------|
| Max clone size | 50 MB |
| Max files to analyze | 50 |
| Max lines per file | 2000 |
| Max total ported lines | 5000 per capability |
| Clone timeout | 30 seconds |
| Analysis timeout | 10 seconds |
| Fusion timeout | 10 seconds |
| Total expandAndExecute timeout | 60 seconds |

### Never

- Never `npm install` (modifies node_modules)
- Never run untrusted code outside the fused wrapper
- Never execute Python/shell from cloned repos
- Never store credentials/tokens from cloned repos
- Never clone repos > 50MB

## 8. Server Restart

On `capabilityExpander.init()`:

1. Scan `fused/` for subdirectories with `manifest.json`
2. Dynamically import each `fused/[name]/index.ts`
3. Re-register in CapabilityRegistry + toolRegistry
4. Log count of restored capabilities

Clone once, use forever.

## 9. Integration Points

### agentExecutor.ts (modification)

In `executeToolCall()`, after tool NOT_FOUND catch:

```typescript
import { capabilityExpander } from './selfExpand/capabilityExpander';

if (error.code === 'NOT_FOUND_ERROR') {
  const expanded = await capabilityExpander.expandAndExecute(
    toolName, args, context, runId, sseRes
  );
  if (expanded) return expanded;
}
```

### Server startup (modification)

```typescript
import { capabilityExpander } from './agent/selfExpand/capabilityExpander';
await capabilityExpander.init();
```

## 10. Autonomy Model

**Autonomous with notification:** The agent auto-expands without asking the user. SSE events notify the UI that a capability is being acquired. The user sees a subtle indicator but is never blocked. If expansion fails, the agent proceeds without the capability and reports the failure.
