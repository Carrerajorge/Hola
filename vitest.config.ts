import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRequire = createRequire(import.meta.url);
const vendoredNodeModulesRoots = [
  path.resolve(__dirname, "./server/openclaw/node_modules"),
  path.resolve(__dirname, "./server/services/superIntelligence/node_modules"),
].filter((root) => fs.existsSync(root));

function isBareImport(id: string) {
  return !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("node:");
}

function splitPackageImport(id: string) {
  if (id.startsWith("@")) {
    const parts = id.split("/");
    const packageName = parts.slice(0, 2).join("/");
    const subpath = parts.slice(2).join("/");
    return { packageName, subpath };
  }
  const [packageName, ...rest] = id.split("/");
  return {
    packageName,
    subpath: rest.join("/"),
  };
}

function resolveExistingFile(candidate: string) {
  const variants = [
    candidate,
    `${candidate}.js`,
    `${candidate}.mjs`,
    `${candidate}.cjs`,
    path.join(candidate, "index.js"),
    path.join(candidate, "index.mjs"),
    path.join(candidate, "index.cjs"),
  ];
  for (const variant of variants) {
    if (fs.existsSync(variant)) {
      return variant;
    }
  }
  return null;
}

function resolvePnpmShimPath(candidate: string) {
  if (!fs.existsSync(candidate) || path.extname(candidate)) {
    return candidate;
  }

  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) {
      return candidate;
    }

    const raw = fs.readFileSync(candidate, "utf8").trim();
    if (!raw.startsWith(".pnpm/")) {
      return candidate;
    }

    const packageRoot = resolveExistingFile(path.resolve(path.dirname(candidate), raw));
    return packageRoot ?? candidate;
  } catch {
    return candidate;
  }
}

function resolveExportTarget(
  packageDir: string,
  exportsField: unknown,
  subpath: string,
): string | null {
  const exportKey = subpath ? `./${subpath}` : ".";
  const pickTarget = (value: unknown): string | null => {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    return (
      (typeof record.import === "string" ? record.import : null) ??
      (typeof record.default === "string" ? record.default : null) ??
      (typeof record.require === "string" ? record.require : null)
    );
  };

  const resolveWildcardTarget = (record: Record<string, unknown>) => {
    for (const [pattern, value] of Object.entries(record)) {
      if (!pattern.includes("*")) {
        continue;
      }
      const [prefix, suffix] = pattern.split("*");
      if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix ?? "")) {
        continue;
      }
      const wildcardValue = exportKey.slice(prefix.length, exportKey.length - (suffix?.length ?? 0));
      const target = pickTarget(value);
      if (!target) {
        continue;
      }
      return target.replaceAll("*", wildcardValue);
    }
    return null;
  };

  let target: string | null = null;
  if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    const record = exportsField as Record<string, unknown>;
    target = pickTarget(record[exportKey]);
    if (!target) {
      target = resolveWildcardTarget(record);
    }
    if (!target && !subpath && !record["."]) {
      target = pickTarget(record);
    }
  } else {
    target = pickTarget(exportsField);
  }

  if (!target) {
    return null;
  }
  return resolveExistingFile(path.resolve(packageDir, target));
}

function resolvePackageFromVendorRoot(id: string, root: string) {
  const { packageName, subpath } = splitPackageImport(id);
  const packageDir = path.join(root, packageName);
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    const exportResolved = resolveExportTarget(packageDir, packageJson.exports, subpath);
    if (exportResolved) {
      return exportResolved;
    }
    if (subpath) {
      return resolveExistingFile(path.resolve(packageDir, subpath));
    }
    const legacyEntry =
      (typeof packageJson.module === "string" ? packageJson.module : null) ??
      (typeof packageJson.main === "string" ? packageJson.main : null);
    if (legacyEntry) {
      return resolveExistingFile(path.resolve(packageDir, legacyEntry));
    }
  } catch {
    return null;
  }
  return null;
}

function isUsableResolvedPath(candidate: string | null) {
  return Boolean(candidate) && path.isAbsolute(candidate) && fs.existsSync(candidate);
}

function resolveFromWorkspace(id: string) {
  try {
    return workspaceRequire.resolve(id);
  } catch {
    return null;
  }
}

function shouldKeepWorkspaceResolution(id: string) {
  return (
    id === "vitest" ||
    id === "vitest/config" ||
    id.startsWith("@vitest/") ||
    id === "happy-dom" ||
    id === "@playwright/test"
  );
}

function isVendoredImporter(importer?: string) {
  if (!importer) {
    return false;
  }
  const normalized = importer.split(path.sep).join("/");
  return (
    normalized.includes("/server/openclaw/") ||
    normalized.includes("/server/services/superIntelligence/")
  );
}

function resolveVendoredDependency(id: string, importer?: string) {
  if (!isBareImport(id)) {
    return null;
  }
  if (shouldKeepWorkspaceResolution(id)) {
    return null;
  }
  const preferVendored = isVendoredImporter(importer);
  const roots = preferVendored ? vendoredNodeModulesRoots : [];

  const tryResolveFromRoots = (candidateRoots: string[]) => {
    for (const root of candidateRoots) {
      try {
        const requireFromRoot = createRequire(path.join(root, "__vitest_vendor_resolver__.cjs"));
        return resolvePnpmShimPath(requireFromRoot.resolve(id));
      } catch {
        const manuallyResolved = resolvePackageFromVendorRoot(id, root);
        if (manuallyResolved) {
          return manuallyResolved;
        }
      }
    }
    return null;
  };

  const workspaceResolved = resolveFromWorkspace(id);
  if (workspaceResolved) {
    return workspaceResolved;
  }

  const vendoredResolved = tryResolveFromRoots(roots);
  if (isUsableResolvedPath(vendoredResolved)) {
    return vendoredResolved;
  }

  const fallbackVendoredResolved = tryResolveFromRoots(vendoredNodeModulesRoots);
  return isUsableResolvedPath(fallbackVendoredResolved) ? fallbackVendoredResolved : null;
}

export default defineConfig({
  plugins: [
    {
      name: "vitest-vendored-deps-resolver",
      enforce: "pre",
      resolveId(source, importer) {
        return resolveVendoredDependency(source, importer);
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["**/*.browser.test.ts", "happy-dom"],
    ],
    testTimeout: 15000,
    include: ["tests/**/*.test.ts", "server/**/*.test.ts"],
    exclude: [
      "server/openclaw/**",
      "**/*.integration.test.ts",
      "**/*.integration.spec.ts",
      "dist/**",
      "node_modules/**",
      "Hola/**",
      "Hola_wt_*/**",
      ".claude/**",
      ".codex/**",
      "**/*.e2e.test.ts",
      "**/*.e2e.spec.ts",
      "server/workflow/schemaSetup.ts",
      "tests/integration/**",
      "server/workflow/workflowStore.test.ts",
      "server/services/superIntelligence/**/*.test.ts",
      "server/services/superIntelligence/**/*.spec.ts",

      "server/agent/__tests__/agent.test.ts",
      "tests/unit/pipeline-tools-registration.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      // Keep coverage output stable; scripts/quality-gate.ts controls cleanup + thresholds.
      clean: false,
      reporter: ["text", "json", "json-summary", "html"],
      all: true,
      include: ["server/core/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__tests__/**", "**/node_modules/**", "**/dist/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
      tslog: path.resolve(__dirname, "./node_modules/tslog/esm/index.js"),
      json5: path.resolve(__dirname, "./node_modules/json5/lib/index.js"),
    },
  },
});
