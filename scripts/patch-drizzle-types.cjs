/**
 * drizzle-orm v0.45 ships only .d.cts type declarations but its package.json
 * exports claim ./index.d.ts (ESM). Under moduleResolution:"bundler" TypeScript
 * cannot resolve the types. This script creates lightweight .d.ts shims that
 * re-export from the existing .d.cts files.
 */
const fs = require("fs");
const path = require("path");

const DRIZZLE_ROOT = path.join(__dirname, "..", "node_modules", "drizzle-orm");

function patchDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      count += patchDir(full);
      continue;
    }
    if (!entry.endsWith(".d.cts")) continue;
    const dtsPath = full.replace(/\.d\.cts$/, ".d.ts");
    if (fs.existsSync(dtsPath)) continue;
    try {
      fs.copyFileSync(full, dtsPath);
      count++;
    } catch {
      // Ignore permission errors
    }
  }
  return count;
}

if (fs.existsSync(DRIZZLE_ROOT)) {
  const patched = patchDir(DRIZZLE_ROOT);
  if (patched > 0) {
    console.log(`[patch-drizzle-types] Created ${patched} .d.ts shims for drizzle-orm`);
  }
} else {
  // Not installed yet — skip silently.
}
