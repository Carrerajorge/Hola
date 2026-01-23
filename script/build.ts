import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist: string[] = [];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    banner: {
      js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
      `.trim(),
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("building worker...");
  await esbuild({
    entryPoints: ["server/worker.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/worker.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    banner: {
      js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
      `.trim(),
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Create a minimal CJS entry point that loads the ESM bundle
  console.log("creating start wrapper...");
  const startWrapper = `#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "index.mjs")).href).catch(err => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
`;
  await writeFile("dist/index.cjs", startWrapper, "utf-8");

  const workerWrapper = `#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "worker.mjs")).href).catch(err => {
  console.error("Failed to start worker:", err);
  process.exit(1);
});
`;
  await writeFile("dist/worker.cjs", workerWrapper, "utf-8");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
