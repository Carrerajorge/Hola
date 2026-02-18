import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const coreRoot = path.resolve(repoRoot, "server/core");
const sharedRoot = path.resolve(repoRoot, "shared");

function walk(dir: string, out: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!full.endsWith(".ts")) continue;
    if (full.endsWith(".test.ts")) continue;
    out.push(full);
  }
}

function resolveImport(fromFile: string, specifier: string): string {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return base;
}

function extractImports(source: string): string[] {
  const imports: string[] = [];
  const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
  const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [importRe, dynamicRe, requireRe]) {
    for (let match = re.exec(source); match; match = re.exec(source)) {
      imports.push(match[1]);
    }
  }

  return imports;
}

function isInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function main() {
  if (!fs.existsSync(coreRoot)) {
    console.log("[layer-check] server/core missing, skipping");
    process.exit(0);
  }

  const files: string[] = [];
  walk(coreRoot, files);

  const violations: Array<{ file: string; spec: string; resolved: string }> = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const specs = extractImports(raw);
    for (const spec of specs) {
      if (!spec) continue;
      if (spec.startsWith("node:")) continue;
      if (spec === "@shared" || spec.startsWith("@shared/")) continue;
      if (!spec.startsWith(".")) continue;

      const resolved = resolveImport(file, spec);
      if (isInside(coreRoot, resolved)) continue;
      if (isInside(sharedRoot, resolved)) continue;

      violations.push({ file, spec, resolved });
    }
  }

  if (violations.length === 0) {
    console.log("[layer-check] passed");
    process.exit(0);
  }

  console.error("[layer-check] failed: core imports must not escape server/core or shared");
  for (const v of violations.slice(0, 50)) {
    console.error(`- ${path.relative(repoRoot, v.file)} imports "${v.spec}" -> ${path.relative(repoRoot, v.resolved)}`);
  }
  process.exit(1);
}

main();

