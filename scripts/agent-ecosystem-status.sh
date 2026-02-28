#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ECOSYSTEM_DIR="$ROOT_DIR/external/agent_ecosystem"
REPOS_LIST="$ECOSYSTEM_DIR/repos.list"
OUT_JSON="$ECOSYSTEM_DIR/repos.manifest.json"

if [[ ! -f "$REPOS_LIST" ]]; then
  echo "[agent-ecosystem] repos.list not found: $REPOS_LIST" >&2
  exit 1
fi

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.resolve(process.cwd(), "external/agent_ecosystem");
const reposListPath = path.join(root, "repos.list");
const outPath = path.join(root, "repos.manifest.json");
const lines = fs.readFileSync(reposListPath, "utf8").split(/\r?\n/).filter(Boolean);

const repos = [];
for (const line of lines) {
  const [name, url] = line.split("|");
  const dir = path.join(root, name);
  const gitDir = path.join(dir, ".git");
  const exists = fs.existsSync(gitDir);

  let branch = null;
  let commit = null;
  let sizeKb = null;
  if (exists) {
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir }).toString().trim();
      commit = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
      sizeKb = Number(execSync(`du -sk ${JSON.stringify(dir)} | awk '{print $1}'`, {
        cwd: root,
        shell: "/bin/zsh",
      }).toString().trim());
    } catch {}
  }

  repos.push({
    name,
    url,
    path: `external/agent_ecosystem/${name}`,
    exists,
    branch,
    commit,
    sizeKb,
  });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  total: repos.length,
  cloned: repos.filter((repo) => repo.exists).length,
  missing: repos.filter((repo) => !repo.exists).map((repo) => repo.name),
  repos,
};

fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const header = ["repo", "state", "branch", "commit", "size_mb"];
const rows = repos.map((repo) => [
  repo.name,
  repo.exists ? "ok" : "missing",
  repo.branch ?? "-",
  repo.commit ? repo.commit.slice(0, 12) : "-",
  repo.sizeKb ? (repo.sizeKb / 1024).toFixed(1) : "-",
]);

const widths = header.map((col, i) =>
  Math.max(col.length, ...rows.map((row) => String(row[i]).length)),
);
const render = (cells) =>
  cells.map((cell, i) => String(cell).padEnd(widths[i], " ")).join("  ");

console.log(render(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) {
  console.log(render(row));
}

console.log(
  `\n[agent-ecosystem] cloned=${manifest.cloned}/${manifest.total} missing=${manifest.missing.length}`,
);
console.log(`[agent-ecosystem] manifest=${path.relative(process.cwd(), outPath)}`);
NODE
