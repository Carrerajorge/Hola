import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repositorySnapshotService } from "../openclaw/repositorySnapshotService";

const tempDirectories: string[] = [];

function createSnapshotRepo(): string {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-repository-snapshot-"),
  );
  tempDirectories.push(repositoryRoot);

  fs.mkdirSync(path.join(repositoryRoot, ".github", "workflows"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repositoryRoot, "apps", "web"), { recursive: true });
  fs.mkdirSync(path.join(repositoryRoot, "packages", "ui"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repositoryRoot, "server", "openclaw"), {
    recursive: true,
  });

  fs.writeFileSync(
    path.join(repositoryRoot, "package.json"),
    JSON.stringify(
      {
        name: "hola-root",
        workspaces: ["apps/*", "packages/*"],
        scripts: {
          dev: "turbo dev",
          build: "turbo build",
          test: "vitest run",
          lint: "eslint .",
          "verify:openclaw-upstream": "node scripts/verify-openclaw.mjs",
        },
        dependencies: {
          react: "^19.0.0",
          openclaw: "workspace:*",
        },
        devDependencies: {
          vitest: "^4.0.0",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  fs.writeFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
  fs.writeFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n", "utf-8");
  fs.writeFileSync(path.join(repositoryRoot, "turbo.json"), "{ \"pipeline\": {} }\n", "utf-8");
  fs.writeFileSync(path.join(repositoryRoot, ".env.production"), "TOKEN=secret\n", "utf-8");
  fs.writeFileSync(
    path.join(repositoryRoot, ".github", "workflows", "deploy-production.yml"),
    "name: Deploy Production\n",
    "utf-8",
  );

  fs.writeFileSync(
    path.join(repositoryRoot, "apps", "web", "package.json"),
    JSON.stringify(
      {
        name: "web",
        scripts: {
          dev: "next dev",
          build: "next build",
          test: "vitest run",
          lint: "eslint .",
        },
        dependencies: {
          next: "^15.0.0",
          react: "^19.0.0",
        },
        devDependencies: {
          vitest: "^4.0.0",
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(repositoryRoot, "packages", "ui", "package.json"),
    JSON.stringify(
      {
        name: "ui",
        dependencies: {
          react: "^19.0.0",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  return repositoryRoot;
}

beforeEach(() => {
  repositorySnapshotService.clear();
});

afterEach(() => {
  repositorySnapshotService.clear();
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("repositorySnapshotService", () => {
  it("detects stack, commands, workflows and OpenClaw signals from the repo", () => {
    const repositoryRoot = createSnapshotRepo();

    const snapshot = repositorySnapshotService.capture({
      repositoryPath: repositoryRoot,
      selectedFolder: "apps/web",
      codingAgents: ["coder"],
      runtimeTarget: "Local",
      executionAccess: "Full access",
      branch: "main",
    });

    expect(snapshot.repositoryExists).toBe(true);
    expect(snapshot.packageManager).toBe("pnpm");
    expect(snapshot.repoStyle).toBe("monorepo");
    expect(snapshot.selectedRoot).toBe("apps/web");
    expect(snapshot.stacks).toEqual(
      expect.arrayContaining(["Next.js", "React", "Turbo", "Vitest"]),
    );
    expect(snapshot.preferredCommands.dev).toEqual({
      command: "pnpm run dev",
      workingDirectory: "apps/web",
      source: "selected-root",
    });
    expect(snapshot.deployWorkflows).toContain(
      ".github/workflows/deploy-production.yml",
    );
    expect(snapshot.sensitivePaths).toEqual(
      expect.arrayContaining([".env.production", "server/openclaw"]),
    );
    expect(snapshot.openClawSignals).toEqual(
      expect.arrayContaining(["package.json:openclaw", "server/openclaw"]),
    );
  });

  it("reuses the cached snapshot for the same repo and selected folder", () => {
    const repositoryRoot = createSnapshotRepo();
    const workspaceContext = {
      repositoryPath: repositoryRoot,
      selectedFolder: "apps/web",
      codingAgents: ["coder"] as const,
      runtimeTarget: "Local",
      executionAccess: "Full access",
      branch: "main",
    };

    const first = repositorySnapshotService.capture(workspaceContext);
    const second = repositorySnapshotService.capture(workspaceContext);

    expect(second).toBe(first);
  });
});
