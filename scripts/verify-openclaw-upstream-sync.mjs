import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(repoRoot, "server", "openclaw", "fusion", "upstream-release.json");

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function ensureOpenClawRemote(remoteName) {
  const remotes = runGit(["remote"]).split(/\r?\n/).filter(Boolean);
  if (!remotes.includes(remoteName)) {
    runGit(["remote", "add", remoteName, "https://github.com/openclaw/openclaw.git"]);
  }
}

function ensureUpstreamTag(tag, remoteName) {
  try {
    runGit(["rev-parse", "--verify", `${tag}^{commit}`]);
    return;
  } catch {
    ensureOpenClawRemote(remoteName);
    runGit(["fetch", "--depth=1", remoteName, `tag`, tag]);
  }
}

function isIgnoredDriftPath(filePath) {
  return (
    /(^|\/).*(test|spec|harness|helpers?)\.(ts|tsx|js|mjs|cjs|mts|cts)$/.test(filePath) ||
    filePath.includes(".test-support.") ||
    filePath.endsWith("README.md")
  );
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const {
    tag,
    commit,
    packageVersion,
    criticalPrefixes,
    allowedDriftPaths,
  } = manifest;

  ensureUpstreamTag(tag, "openclaw");

  const resolvedCommit = runGit(["rev-parse", `${tag}^{commit}`]);
  if (resolvedCommit !== commit) {
    throw new Error(
      `OpenClaw upstream tag ${tag} resolved to ${resolvedCommit}, expected ${commit}. Update ${path.relative(repoRoot, manifestPath)}.`,
    );
  }

  const embeddedPackageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "server", "openclaw", "package.json"), "utf8"),
  );
  if (embeddedPackageJson.version !== packageVersion) {
    throw new Error(
      `Embedded OpenClaw version is ${embeddedPackageJson.version}, expected ${packageVersion}.`,
    );
  }

  const diffOutput = runGit([
    "diff",
    "--name-status",
    `${tag}`,
    "HEAD:server/openclaw",
    "--",
    ...criticalPrefixes,
  ]);

  const diffLines = diffOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const allowed = new Set(allowedDriftPaths);
  const unexpected = diffLines.filter((line) => {
    const parts = line.split(/\s+/);
    const filePath = parts.at(-1);
    return !allowed.has(filePath) && !isIgnoredDriftPath(filePath);
  });

  if (unexpected.length > 0) {
    const details = unexpected.map((line) => `  - ${line}`).join("\n");
    throw new Error(
      [
        `Unexpected embedded OpenClaw drift detected against ${tag}.`,
        "Only the allowlisted downstream integration files may differ.",
        details,
      ].join("\n"),
    );
  }

  const missingAllowed = allowedDriftPaths.filter(
    (filePath) => !diffLines.some((line) => line.split(/\s+/).at(-1) === filePath),
  );

  console.log(
    [
      `OpenClaw upstream sync verified against ${tag} (${resolvedCommit.slice(0, 10)}).`,
      `Allowlisted drift paths observed: ${allowedDriftPaths.length - missingAllowed.length}/${allowedDriftPaths.length}.`,
      unexpected.length === 0 ? "No unexpected drift detected." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (missingAllowed.length > 0) {
    console.log("Allowlisted paths not currently drifting:");
    for (const filePath of missingAllowed) {
      console.log(`  - ${filePath}`);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
