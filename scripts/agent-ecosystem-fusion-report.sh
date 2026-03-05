#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/external/agent_ecosystem/repos.manifest.json"
REGISTRY_PATH="$ROOT_DIR/external/agent_ecosystem/fusion.registry.json"
OUT_PATH="$ROOT_DIR/artifacts/agent_ecosystem_fusion_status.json"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "[agent-ecosystem] manifest missing. Run ecosystem:status first." >&2
  exit 1
fi

if [[ ! -f "$REGISTRY_PATH" ]]; then
  echo "[agent-ecosystem] registry missing: $REGISTRY_PATH" >&2
  exit 1
fi

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const manifestPath = path.join(root, "external/agent_ecosystem/repos.manifest.json");
const registryPath = path.join(root, "external/agent_ecosystem/fusion.registry.json");
const outPath = path.join(root, "artifacts/agent_ecosystem_fusion_status.json");
const deepAuditPath = path.join(root, "artifacts/agent_ecosystem_deep_audit.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

const normalizeRepoName = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

const byName = new Map();
for (const repo of registry.repos ?? []) {
  const normalized = normalizeRepoName(repo.name);
  byName.set(normalized, repo);
  if (normalized === "openclaw-upstream") {
    byName.set("openclaw", repo);
  }
}

const joined = (manifest.repos ?? []).map((repo) => {
  const reg = byName.get(normalizeRepoName(repo.name)) ?? null;
  const runtimeIntegrated = Boolean(reg?.runtimeIntegrated);
  const codeIntegrated = Boolean(reg?.codeIntegrated);
  return {
    name: repo.name,
    cloned: Boolean(repo.exists),
    runtimeIntegrated,
    codeIntegrated,
    softwareIntegrated: runtimeIntegrated || codeIntegrated,
    controllable: Boolean(repo.exists),
    role: reg?.role ?? "unknown",
    integrationMode: reg?.integrationMode ?? "unknown",
    commit: repo.commit ?? null,
    branch: repo.branch ?? null,
  };
});

const integrationDepthWeights = {
  "embedded-runtime-router": 1.0,
  "docker-compose": 0.75,
  "npm-sdk+control-plane-repo-adapter": 0.65,
  "npm-sdk": 0.6,
  "control-plane-repo-adapter": 0.45,
};

const getDepthWeight = (repo) => {
  const mode = String(repo.integrationMode || "").trim().toLowerCase();
  const base = integrationDepthWeights[mode] ?? 0.2;
  const runtimeFactor = repo.runtimeIntegrated ? 1 : 0.7;
  const codeFactor = repo.codeIntegrated ? 1 : 0.7;
  return Number((base * runtimeFactor * codeFactor).toFixed(4));
};

const total = joined.length;
const cloned = joined.filter((repo) => repo.cloned).length;
const runtimeIntegrated = joined.filter((repo) => repo.runtimeIntegrated).length;
const codeIntegrated = joined.filter((repo) => repo.codeIntegrated).length;
const softwareIntegrated = joined.filter((repo) => repo.softwareIntegrated).length;
const controllable = joined.filter((repo) => repo.controllable).length;
const depthScoreSum = joined.reduce((acc, repo) => acc + getDepthWeight(repo), 0);

const report = {
  generatedAt: new Date().toISOString(),
  totalRepos: total,
  clonedRepos: cloned,
  cloneCoveragePct: total ? Number(((cloned / total) * 100).toFixed(2)) : 0,
  runtimeIntegratedRepos: runtimeIntegrated,
  runtimeFusionPct: total ? Number(((runtimeIntegrated / total) * 100).toFixed(2)) : 0,
  codeIntegratedRepos: codeIntegrated,
  codeFusionPct: total ? Number(((codeIntegrated / total) * 100).toFixed(2)) : 0,
  softwareIntegratedRepos: softwareIntegrated,
  softwareFusionPct: total ? Number(((softwareIntegrated / total) * 100).toFixed(2)) : 0,
  totalFusionPct: total ? Number(((softwareIntegrated / total) * 100).toFixed(2)) : 0,
  deepFusionPct: total ? Number(((depthScoreSum / total) * 100).toFixed(2)) : 0,
  controllableRepos: controllable,
  controllablePct: total ? Number(((controllable / total) * 100).toFixed(2)) : 0,
  repos: joined,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`[agent-ecosystem] clone coverage: ${report.clonedRepos}/${report.totalRepos} (${report.cloneCoveragePct}%)`);
console.log(`[agent-ecosystem] runtime fusion: ${report.runtimeIntegratedRepos}/${report.totalRepos} (${report.runtimeFusionPct}%)`);
console.log(`[agent-ecosystem] software fusion: ${report.softwareIntegratedRepos}/${report.totalRepos} (${report.softwareFusionPct}%)`);
console.log(`[agent-ecosystem] deep fusion: ${report.deepFusionPct}%`);
console.log(`[agent-ecosystem] controllable repos: ${report.controllableRepos}/${report.totalRepos} (${report.controllablePct}%)`);
if (fs.existsSync(deepAuditPath)) {
  try {
    const deepAudit = JSON.parse(fs.readFileSync(deepAuditPath, "utf8"));
    const experiential = Number(deepAudit?.summary?.experientialFusionPct ?? NaN);
    if (Number.isFinite(experiential)) {
      console.log(`[agent-ecosystem] experiential fusion: ${experiential}% (from artifacts/agent_ecosystem_deep_audit.json)`);
    }
  } catch {}
}
console.log(`[agent-ecosystem] report: ${path.relative(root, outPath)}`);
NODE
