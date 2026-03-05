import fs from "node:fs/promises";
import path from "node:path";
import { AgentEcosystemService } from "../server/services/agentEcosystemService";

type CliOptions = {
  timeoutMs?: number;
  maxRepos?: number;
  concurrency?: number;
  includeAdapters: boolean;
  includeRuntime: boolean;
  includeSmoke: boolean;
};

function parseIntArg(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    includeAdapters: true,
    includeRuntime: true,
    includeSmoke: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--timeout-ms") {
      options.timeoutMs = parseIntArg(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--max-repos") {
      options.maxRepos = parseIntArg(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--concurrency") {
      options.concurrency = parseIntArg(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--no-adapters") {
      options.includeAdapters = false;
      continue;
    }
    if (token === "--no-runtime") {
      options.includeRuntime = false;
      continue;
    }
    if (token === "--no-smoke") {
      options.includeSmoke = false;
      continue;
    }
  }

  return options;
}

async function main() {
  const root = process.cwd();
  const opts = parseArgs(process.argv.slice(2));
  const service = new AgentEcosystemService({ workspaceRoot: root });
  const audit = await service.deepAuditFusion(opts);

  const outPath = path.join(root, "artifacts", "agent_ecosystem_deep_audit.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  console.log(`[agent-ecosystem] assessed repos: ${audit.assessedRepos}`);
  console.log(
    `[agent-ecosystem] experiential fusion: ${audit.summary.experientialFusionPct}%`,
  );
  console.log(
    `[agent-ecosystem] adapter ready: ${audit.summary.adapterReadyRepos}/${audit.assessedRepos} (${audit.summary.adapterReadyPct}%)`,
  );
  console.log(
    `[agent-ecosystem] runtime ready: ${audit.summary.runtimeReadyRepos} (${audit.summary.runtimeReadyPct}%)`,
  );
  console.log(
    `[agent-ecosystem] smoke ready: ${audit.summary.smokeReadyRepos}/${audit.assessedRepos} (${audit.summary.smokeReadyPct}%)`,
  );
  console.log(
    `[agent-ecosystem] gaps high/medium/low: ${audit.summary.highPriorityGaps}/${audit.summary.mediumPriorityGaps}/${audit.summary.lowPriorityGaps}`,
  );
  console.log(`[agent-ecosystem] report: ${path.relative(root, outPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-ecosystem] deep audit failed: ${message}`);
  process.exit(1);
});
