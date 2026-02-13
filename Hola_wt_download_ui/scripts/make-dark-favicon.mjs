#!/usr/bin/env node
/**
 * Generates a high-contrast dark-mode favicon from the default favicon.
 *
 * Strategy: keep alpha as-is, set all non-transparent pixels to white.
 * This preserves anti-aliasing and ensures visibility on dark browser UI.
 */

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const inPath = process.argv[2] || "client/public/favicon.png";
const outPath = process.argv[3] || "client/public/favicon-dark.png";

function main() {
  const absIn = path.resolve(inPath);
  const absOut = path.resolve(outPath);

  const buf = fs.readFileSync(absIn);
  const png = PNG.sync.read(buf);

  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a === 0) continue;
    // Force white while preserving alpha (anti-aliased edges keep partial alpha)
    png.data[i + 0] = 255;
    png.data[i + 1] = 255;
    png.data[i + 2] = 255;
  }

  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, PNG.sync.write(png));

  process.stdout.write(`Wrote ${path.relative(process.cwd(), absOut)} (from ${path.relative(process.cwd(), absIn)})\n`);
}

main();
