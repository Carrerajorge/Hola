import { build as esbuild, BuildResult } from "esbuild";
import { build as viteBuild } from "vite";
import { copyFile, mkdir, rm, readFile, writeFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist: string[] = [];

async function bumpBuiltSwCleanupVersion() {
  // Ensure the built SW cleanup script changes on each production build.
  // This breaks the cache-cycle for users who still have an older Service Worker
  // that serves stale HTML/JS after deploys.
  const swCleanupPath = "dist/public/sw-cleanup.js";
  let src: string;
  try {
    src = await readFile(swCleanupPath, "utf-8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;

    // Defensive: some build setups can race the public asset copy step.
    // Ensure we have the cleanup script before we bump its version.
    await mkdir("dist/public", { recursive: true });
    await copyFile("client/public/sw-cleanup.js", swCleanupPath);
    src = await readFile(swCleanupPath, "utf-8");
  }

  const version = `build-${Date.now()}`;
  const next = src.replace(
    /var APP_VERSION = '([^']*)';/,
    `var APP_VERSION = '${version}';`
  );

  if (next === src) {
    throw new Error(
      `[build] Failed to bump APP_VERSION in ${swCleanupPath} (pattern not found)`
    );
  }

  await writeFile(swCleanupPath, next, "utf-8");
  console.log(`[build] dist sw-cleanup APP_VERSION -> ${version}`);
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  // Some environments terminate long-running commands that don't emit output.
  // Emit a small heartbeat while Vite is working to keep logs alive.
  const clientHeartbeat = setInterval(() => {
    console.log("[build] client build still running...");
  }, 15000);
  try {
    await viteBuild();
  } finally {
    clearInterval(clientHeartbeat);
  }

  await bumpBuiltSwCleanupVersion();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  // Common esbuild options for optimal bundle size
  const commonOptions = {
    platform: "node" as const,
    bundle: true,
    format: "esm" as const,
    treeShaking: true,
    minify: true,
    splitting: true, // Enable code splitting to share common chunks between server and worker
    // Mark ALL node_modules as external - they're installed at runtime
    external: [...externals, "./node_modules/*"],
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
    logLevel: "info" as const,
  };

  // Build server and worker together to enable splitting
  const serverResult: BuildResult = await esbuild({
    ...commonOptions,
    entryPoints: ["server/index.ts", "server/worker.ts", "server/agent/sandboxRunner/index.ts"],
    outdir: "dist",
    outExtension: { ".js": ".mjs" },
    splitting: true,
    metafile: true,
  });

  // Output bundle analysis
  if (serverResult.metafile) {
    const totalBytes = Object.values(serverResult.metafile.outputs)
      .reduce((sum, output) => sum + output.bytes, 0);
    console.log(`Total server bundle size: ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);

    // Find largest inputs for index.mjs
    const serverOutput = serverResult.metafile.outputs["dist/index.mjs"];
    if (serverOutput?.inputs) {
      const sortedInputs = Object.entries(serverOutput.inputs)
        .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
        .slice(0, 10);
      console.log("Top 10 largest modules in server bundle:");
      sortedInputs.forEach(([name, info]) => {
        console.log(`  ${(info.bytesInOutput / 1024).toFixed(1)}KB - ${name}`);
      });
    }
  }

  // Create a minimal CJS entry point that loads the ESM bundle
  console.log("creating start wrapper...");
  const startWrapper = `#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");

console.log("[Wrapper] Starting application...");
const modulePath = join(__dirname, "index.mjs");
console.log("[Wrapper] Loading ESM module from:", modulePath);

import(pathToFileURL(modulePath).href)
  .then(() => console.log("[Wrapper] Module loaded successfully"))
  .catch(err => {
    console.error("[Wrapper] Failed to start application:", err);
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

  const sandboxRunnerWrapper = `#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "agent/sandboxRunner/index.mjs")).href).catch(err => {
  console.error("Failed to start sandbox runner:", err);
  process.exit(1);
});
`;
  await writeFile("dist/sandbox-runner.cjs", sandboxRunnerWrapper, "utf-8");
}


buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
