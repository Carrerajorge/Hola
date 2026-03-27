import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
}));

import { spawnCodexSubagents } from "@/services/codexRuntime";

describe("codexRuntime subagents", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("sends structured workspace context with subagent spawns", async () => {
    apiRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "subagent-1",
          requesterUserId: "user-1",
          objective: "Implementa la solucion",
          planHint: ["role:coder"],
          executionProfile: "standard",
          status: "queued",
          createdAt: Date.now(),
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await spawnCodexSubagents({
      runId: "run-1",
      message: "Implementa la solución principal",
      executionProfile: "standard",
      maxSubagents: 1,
      branchName: "main",
      project: {
        id: "project-1",
        name: "Hola",
        color: "#111827",
        backgroundImage: null,
        systemPrompt: "",
        repositoryPath: "/workspace/hola",
        defaultCodeFolder: "server/openclaw",
        codingAgents: ["coder"],
        files: [],
        chatIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/openclaw/runtime/subagents",
      expect.objectContaining({
        executionProfile: "standard",
        workspaceContext: {
          projectId: "project-1",
          projectName: "Hola",
          repositoryPath: "/workspace/hola",
          selectedFolder: "server/openclaw",
          codingAgents: ["coder"],
          runtimeTarget: "Local",
          executionAccess: "Full access",
          branch: "main",
        },
      }),
    );
  });
});
