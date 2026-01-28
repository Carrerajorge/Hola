import { build as esbuild, BuildResult } from "esbuild";
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

  // Common esbuild options for optimal bundle size
  const commonOptions = {
    platform: "node" as const,
    bundle: true,
    format: "esm" as const,
    treeShaking: true,
    minify: true,
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

  const serverResult: BuildResult = await esbuild({
    ...commonOptions,
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.mjs",
    metafile: true,
  });

  // Output bundle analysis
  if (serverResult.metafile) {
    const totalBytes = Object.values(serverResult.metafile.outputs)
      .reduce((sum, output) => sum + output.bytes, 0);
    console.log(`Server bundle: ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);

    // Find largest inputs
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

  console.log("building worker...");
  await esbuild({
    ...commonOptions,
    entryPoints: ["server/worker.ts"],
    outfile: "dist/worker.mjs",
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
