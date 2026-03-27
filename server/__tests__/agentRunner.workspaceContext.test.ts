import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRunner } from "../services/agentRunner";
import { defaultToolRegistry, type ToolRegistry } from "../agent/sandbox/tools";

const tempDirectories: string[] = [];

function createWorkspaceRepo(): { repositoryRoot: string; workspaceDir: string } {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runner-workspace-"));
  tempDirectories.push(repositoryRoot);

  const workspaceDir = path.join(repositoryRoot, "packages", "app");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(repositoryRoot, "package.json"),
    JSON.stringify(
      {
        name: "snapshot-root",
        scripts: {
          test: "vitest run",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        name: "workspace-app",
        scripts: {
          dev: "vite dev",
          build: "vite build",
          test: "vitest run",
        },
        dependencies: {
          vite: "^7.0.0",
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
  fs.writeFileSync(path.join(workspaceDir, "index.ts"), "export const ok = true;\n", "utf-8");

  return { repositoryRoot, workspaceDir };
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("AgentRunner workspace context", () => {
  it("creates a workspace-scoped tool registry for shell and file tools", async () => {
    const { repositoryRoot, workspaceDir } = createWorkspaceRepo();
    const runner = new AgentRunner({
      executionProfile: "standard",
      workspaceContext: {
        repositoryPath: repositoryRoot,
        selectedFolder: "packages/app",
        codingAgents: ["coder"],
        runtimeTarget: "Local",
        executionAccess: "Full access",
        branch: "main",
      },
    });

    const registry = (runner as any).toolRegistry as ToolRegistry;
    expect(registry).not.toBe(defaultToolRegistry);
    expect((runner as any).repositorySnapshot).toMatchObject({
      selectedRoot: "packages/app",
      packageManager: "unknown",
      stacks: expect.arrayContaining(["TypeScript", "Vite", "Vitest"]),
    });

    const shellResult = await registry.execute("shell", { command: "pwd" });
    expect(shellResult.success).toBe(true);
    expect(shellResult.data?.stdout?.trim()).toBe(fs.realpathSync(workspaceDir));

    const fileResult = await registry.execute("file", {
      operation: "list",
      path: ".",
    });
    expect(fileResult.success).toBe(true);
    expect(fileResult.data?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "index.ts",
        }),
      ]),
    );
  });
});
