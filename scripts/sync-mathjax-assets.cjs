#!/usr/bin/env node
// Copies MathJax runtime assets into Vite's `public/` folder so MathJax can be
// loaded locally (offline-friendly) without relying on a CDN.

const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const mathjaxPkgJson = path.join(repoRoot, "node_modules", "mathjax", "package.json");
  const mathjaxEs5Dir = path.join(repoRoot, "node_modules", "mathjax", "es5");

  if (!fileExists(mathjaxPkgJson) || !fileExists(mathjaxEs5Dir)) {
    console.error(
      "[sync-mathjax-assets] MathJax is not installed. Run `npm install` first."
    );
    process.exit(1);
  }

  const { version } = readJson(mathjaxPkgJson);
  const destRoot = path.join(repoRoot, "client", "public", "vendor", "mathjax");
  const stampPath = path.join(destRoot, ".mathjax-version");
  const expectedEntry = path.join(destRoot, "tex-chtml.js");

  if (fileExists(stampPath) && fileExists(expectedEntry)) {
    const existing = fs.readFileSync(stampPath, "utf8").trim();
    if (existing === version) {
      // Already synced for this MathJax version.
      return;
    }
  }

  console.log(`[sync-mathjax-assets] Syncing MathJax v${version} assets...`);

  // Replace the folder to avoid stale files when MathJax is upgraded/downgraded.
  rmIfExists(destRoot);
  ensureDir(destRoot);

  fs.cpSync(mathjaxEs5Dir, destRoot, { recursive: true });
  fs.writeFileSync(stampPath, `${version}\n`, "utf8");

  if (!fileExists(expectedEntry)) {
    console.error(
      "[sync-mathjax-assets] Sync completed but entry file is missing:",
      expectedEntry
    );
    process.exit(1);
  }

  console.log("[sync-mathjax-assets] Done.");
}

main();
