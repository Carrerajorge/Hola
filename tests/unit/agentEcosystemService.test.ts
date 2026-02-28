import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEcosystemService } from "../../server/services/agentEcosystemService";

async function setupTempRepoWorkspace(repoName = "demo-repo") {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-ecosystem-service-"));
  const ecosystemDir = path.join(tmpRoot, "external", "agent_ecosystem");
  const repoDir = path.join(ecosystemDir, repoName);
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(
    path.join(ecosystemDir, "repos.manifest.json"),
    JSON.stringify(
      {
        repos: [
          {
            name: repoName,
            exists: true,
            path: `external/agent_ecosystem/${repoName}`,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return { tmpRoot, ecosystemDir, repoDir, repoName };
}

describe("AgentEcosystemService", () => {
  const originalFetch = global.fetch;
  const originalProxyEnv = process.env.AGENT_ECOSYSTEM_ENABLE_PROXY;
  const originalLocalOnlyEnv = process.env.AGENT_ECOSYSTEM_LOCAL_ONLY;
  const service = new AgentEcosystemService({ workspaceRoot: "/Users/luis/Desktop/Hola" });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalProxyEnv === undefined) {
      delete process.env.AGENT_ECOSYSTEM_ENABLE_PROXY;
    } else {
      process.env.AGENT_ECOSYSTEM_ENABLE_PROXY = originalProxyEnv;
    }
    if (originalLocalOnlyEnv === undefined) {
      delete process.env.AGENT_ECOSYSTEM_LOCAL_ONLY;
    } else {
      process.env.AGENT_ECOSYSTEM_LOCAL_ONLY = originalLocalOnlyEnv;
    }
  });

  it("resolves configured services with defaults for core stack", () => {
    const services = service.getConfiguredServices();
    const ollama = services.find((entry) => entry.id === "ollama");
    const qdrant = services.find((entry) => entry.id === "qdrant");
    const n8n = services.find((entry) => entry.id === "n8n");
    const flowise = services.find((entry) => entry.id === "flowise");
    const openclaw = services.find((entry) => entry.id === "openclaw");

    expect(services.length).toBeGreaterThanOrEqual(17);
    expect(ollama?.enabled).toBe(true);
    expect(ollama?.baseUrl).toBe("http://localhost:11434");
    expect(qdrant?.enabled).toBe(true);
    expect(n8n?.enabled).toBe(true);
    expect(flowise?.baseUrl).toBe("http://localhost:3001");
    expect(openclaw?.baseUrl).toBe("http://localhost:5000");
  });

  it("proxies JSON requests to allowed service endpoints", async () => {
    process.env.AGENT_ECOSYSTEM_LOCAL_ONLY = "true";
    process.env.AGENT_ECOSYSTEM_ENABLE_PROXY = "true";

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ version: "test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as any;

    const result = await service.proxyRequest({
      service: "ollama",
      method: "GET",
      path: "/api/version",
      query: { source: "unit" },
      timeoutMs: 1500,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.url).toContain("http://localhost:11434/api/version");
    expect(result.url).toContain("source=unit");
    expect(result.body).toEqual({ version: "test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects proxy attempts using absolute URLs", async () => {
    process.env.AGENT_ECOSYSTEM_LOCAL_ONLY = "true";
    process.env.AGENT_ECOSYSTEM_ENABLE_PROXY = "true";

    await expect(
      service.proxyRequest({
        service: "ollama",
        method: "GET",
        path: "https://evil.example/override",
      }),
    ).rejects.toThrow(/relative/i);
  });

  it("keeps HTTP proxy disabled by default in local-only mode", async () => {
    process.env.AGENT_ECOSYSTEM_LOCAL_ONLY = "true";
    delete process.env.AGENT_ECOSYSTEM_ENABLE_PROXY;

    await expect(
      service.proxyRequest({
        service: "ollama",
        method: "GET",
        path: "/api/version",
      }),
    ).rejects.toThrow(/service_proxy_disabled/i);
  });

  it("executes a guarded command inside a cloned ecosystem repo", async () => {
    const { tmpRoot, repoName } = await setupTempRepoWorkspace();
    try {
      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.execRepoCommand({
        repo: repoName,
        command: "node",
        args: ["-e", "process.stdout.write('ok')"],
        timeoutMs: 5000,
      });

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.repo).toBe(repoName);
      expect(result.stdout).toContain("ok");
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("searches code inside a cloned ecosystem repo", async () => {
    const { tmpRoot, repoDir, repoName } = await setupTempRepoWorkspace();
    try {
      await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(repoDir, "src", "hello.ts"),
        "export const hello = 'fusion-ready';\n",
        "utf8",
      );

      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.searchRepoCode({
        repo: repoName,
        pattern: "fusion-ready",
        maxResults: 10,
      });

      expect(result.ok).toBe(true);
      expect(result.totalHits).toBeGreaterThan(0);
      expect(result.hits[0]?.repo).toBe(repoName);
      expect(result.hits[0]?.file).toContain("src/hello.ts");
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("reads a repo file with traversal safeguards", async () => {
    const { tmpRoot, repoDir, repoName } = await setupTempRepoWorkspace();
    try {
      await fs.mkdir(path.join(repoDir, "docs"), { recursive: true });
      await fs.writeFile(
        path.join(repoDir, "docs", "note.md"),
        `${"line-content-".repeat(120)}\n`,
        "utf8",
      );

      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.readRepoFile({
        repo: repoName,
        filePath: "docs/note.md",
        maxBytes: 1000,
      });

      expect(result.ok).toBe(true);
      expect(result.repo).toBe(repoName);
      expect(result.filePath).toBe("docs/note.md");
      expect(result.content).toContain("line-content");
      expect(result.truncated).toBe(true);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("probes runtime adapter for a single repo", async () => {
    const { tmpRoot, repoName } = await setupTempRepoWorkspace();
    try {
      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.probeRepoAdapter({
        repo: repoName,
        timeoutMs: 5000,
      });

      expect(result.ok).toBe(true);
      expect(result.repo).toBe(repoName);
      expect(result.adapter).toBe("control-plane-repo-adapter");
      expect(result.stdout).toContain(repoName);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("probes runtime adapters in bulk", async () => {
    const { tmpRoot, repoDir: repoDirA, ecosystemDir } = await setupTempRepoWorkspace("repo-a");
    try {
      const repoBDir = path.join(ecosystemDir, "repo-b");
      await fs.mkdir(repoBDir, { recursive: true });
      await fs.writeFile(
        path.join(ecosystemDir, "repos.manifest.json"),
        JSON.stringify(
          {
            repos: [
              {
                name: "repo-a",
                exists: true,
                path: "external/agent_ecosystem/repo-a",
              },
              {
                name: "repo-b",
                exists: true,
                path: "external/agent_ecosystem/repo-b",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.probeAllRepoAdapters({
        timeoutMs: 5000,
      });

      expect(result.total).toBe(2);
      expect(result.okCount).toBe(2);
      expect(result.failCount).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.okPct).toBe(100);
      expect(result.probes.map((probe) => probe.repo).sort()).toEqual(["repo-a", "repo-b"]);
      expect(await fs.stat(repoDirA)).toBeTruthy();
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("runs deep audit and returns 100 experiential score for a healthy local repo", async () => {
    const { tmpRoot, repoDir, repoName } = await setupTempRepoWorkspace();
    try {
      await fs.writeFile(path.join(repoDir, "README.md"), "# demo\n", "utf8");

      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.deepAuditFusion({
        timeoutMs: 5000,
        includeRuntime: false,
        includeAdapters: true,
        includeSmoke: true,
      });

      expect(result.assessedRepos).toBe(1);
      expect(result.summary.experientialFusionPct).toBe(100);
      expect(result.summary.highPriorityGaps).toBe(0);
      expect(result.repos[0]?.scorePct).toBe(100);
      expect(result.repos[0]?.smoke?.ok).toBe(true);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("flags missing clone as high-priority gap in deep audit", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-ecosystem-service-"));
    const ecosystemDir = path.join(tmpRoot, "external", "agent_ecosystem");
    await fs.mkdir(ecosystemDir, { recursive: true });
    await fs.writeFile(
      path.join(ecosystemDir, "repos.manifest.json"),
      JSON.stringify(
        {
          repos: [
            {
              name: "missing-repo",
              exists: false,
              path: "external/agent_ecosystem/missing-repo",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.deepAuditFusion({
        timeoutMs: 5000,
        includeRuntime: false,
        includeAdapters: true,
        includeSmoke: true,
      });

      expect(result.assessedRepos).toBe(1);
      expect(result.summary.highPriorityGaps).toBeGreaterThanOrEqual(1);
      expect(result.gaps.some((gap) => gap.category === "clone" && gap.severity === "high")).toBe(true);
      expect(result.repos[0]?.cloned).toBe(false);
      expect(result.repos[0]?.scorePct).toBe(0);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("reports runtime gaps for mapped runtime repos in deep audit", async () => {
    const { tmpRoot, ecosystemDir } = await setupTempRepoWorkspace("ollama");
    const ollamaDir = path.join(ecosystemDir, "ollama");
    try {
      await fs.mkdir(path.join(ollamaDir, "cmd"), { recursive: true });
      await fs.mkdir(path.join(ollamaDir, "api"), { recursive: true });
      await fs.writeFile(path.join(ollamaDir, "Dockerfile"), "FROM scratch\n", "utf8");

      global.fetch = vi.fn(
        async () =>
          new Response("down", {
            status: 503,
            headers: { "content-type": "text/plain" },
          }),
      ) as any;

      const tmpService = new AgentEcosystemService({ workspaceRoot: tmpRoot });
      const result = await tmpService.deepAuditFusion({
        timeoutMs: 2000,
        includeRuntime: true,
        includeAdapters: false,
        includeSmoke: true,
      });

      expect(result.assessedRepos).toBe(1);
      expect(result.summary.runtimeReadyRepos).toBe(0);
      expect(result.gaps.some((gap) => gap.category === "runtime" && gap.severity === "high")).toBe(true);
      expect(result.repos[0]?.runtime?.required).toBe(true);
      expect(result.repos[0]?.runtime?.ok).toBe(false);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
