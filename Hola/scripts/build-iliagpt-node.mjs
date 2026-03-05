import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgDir = path.join(__dirname, "..", "packages", "iliagpt-node");

await build({
  entryPoints: [path.join(pkgDir, "src", "cli.ts")],
  outfile: path.join(pkgDir, "dist", "cli.mjs"),
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  sourcemap: true,
});

console.log("[build] iliagpt-node built -> packages/iliagpt-node/dist/cli.mjs");
