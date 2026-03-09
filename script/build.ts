import { build as esbuild, BuildResult } from "esbuild";
import { build as viteBuild } from "vite";
import { copyFile, mkdir, rm, readFile, writeFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times.
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

  // Prefer an explicit version injected at build time (e.g. git SHA via Docker build-arg).
  // Fallback to a timestamp so the cleanup script still changes between builds.
  const version = process.env.VITE_APP_VERSION || process.env.APP_VERSION || `build-${Date.now()}`;
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
  const openClawPkg = JSON.parse(await readFile("server/openclaw/package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(openClawPkg.dependencies || {}),
    ...Object.keys(openClawPkg.devDependencies || {}),
    ...Object.keys(openClawPkg.optionalDependencies || {}),
  ];
  const externals = Array.from(new Set(allDeps.filter((dep) => !allowlist.includes(dep))));
  const appVersion = process.env.VITE_APP_VERSION || process.env.APP_VERSION || `build-${Date.now()}`;

  // Common esbuild options for optimal bundle size
  const commonOptions = {
    platform: "node" as const,
    bundle: true,
    format: "esm" as const,
    treeShaking: true,
    minify: true,
    splitting: true, // Enable code splitting to share common chunks between server and worker
    // Mark ALL node_modules as external - they're installed at runtime
    external: [...externals, "./node_modules/*", "fsevents", "*.node", "@node-llama-cpp/*", "node-llama-cpp", "reflink", "canvas", "@napi-rs/canvas", "chromium-bidi*", "ffmpeg-static"],
    // Resolve path aliases matching tsconfig.json / vite.config.ts
    alias: {
      "@shared": "./shared",
    },
    plugins: [
      {
        name: "zod-v4-server",
        setup(build) {
          // Keep `zod/v4` imports intact while upgrading bare `zod` imports used by
          // server-side schemas to the v4 entrypoint expected by drizzle-zod output.
          build.onResolve({ filter: /^zod$/ }, () => ({
            path: "zod/v4",
            external: true,
          }));
        },
      },
      {
        name: "native-modules",
        setup(build) {
          // Some vendored OpenClaw deps ship platform-specific native packages behind
          // a JS loader. Keep the package import external so Node resolves the right
          // prebuilt binary at runtime instead of esbuild trying to bundle it.
          build.onResolve({ filter: /^@snazzah\/davey(?:-.+)?$/ }, (args) => {
            return {
              path: args.path,
              external: true,
            };
          });

          // If a resolution ends with .node, mark it as external
          build.onResolve({ filter: /\.node$/, namespace: "file" }, (args) => {
            return {
              path: args.path,
              external: true,
            };
          });
        },
      }
    ],
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.APP_VERSION": JSON.stringify(appVersion),
    },
    banner: {
      js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Some dependencies still reference CommonJS globals (module/exports) even when bundled.
// When output format is ESM, these are not defined by Node.
// Provide a minimal shim to avoid runtime crashes like:
//   ReferenceError: module is not defined in ES module scope
const module = { exports: {} };
const exports = module.exports;

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
    entryPoints: ["server/index.ts", "server/worker.ts", "server/migrate.ts", "server/agent/sandboxRunner/index.ts", "server/routes/nodesRouter.ts"],
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

// Polyfill browser globals needed by pdf-parse and canvas libraries in Node.js
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.m11=1;this.m12=0;this.m13=0;this.m14=0;this.m21=0;this.m22=1;this.m23=0;this.m24=0;this.m31=0;this.m32=0;this.m33=1;this.m34=0;this.m41=0;this.m42=0;this.m43=0;this.m44=1;this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; }
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData { constructor(w,h) { this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4); } };
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D { constructor() {} };
}

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

  const migrateWrapper = `#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "migrate.mjs")).href).catch(err => {
  console.error("Failed to run migrations:", err);
  process.exit(1);
});
`;
  await writeFile("dist/migrate.cjs", migrateWrapper, "utf-8");

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


buildAll()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
