import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: async () => ({}),
      }),
    }),
  },
}));

const chatMock = vi.fn();
vi.mock("../../server/lib/llmGateway", () => ({
  llmGateway: {
    chat: (...args: any[]) => chatMock(...args),
  },
}));

const getObjectEntityBufferMock = vi.fn();
vi.mock("../../server/replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityBuffer(...args: any[]) {
      return getObjectEntityBufferMock(...args);
    }
  },
}));

import { AgentOrchestrator } from "../../server/agent/agentOrchestrator";

describe("AgentOrchestrator image direct response", () => {
  beforeEach(() => {
    chatMock.mockReset();
    getObjectEntityBufferMock.mockReset();
  });

  it("responds directly with vision when the user attaches an image exercise", async () => {
    chatMock.mockResolvedValue({ content: "La distancia correcta es 1 m." });
    getObjectEntityBufferMock.mockResolvedValue(Buffer.from("fake-image-binary"));

    const orchestrator = new AgentOrchestrator("run-image", "chat-image", "user-image", "pro");

    const plan = await orchestrator.generatePlan("Resuelve este ejercicio", [
      {
        name: "ejercicio.png",
        type: "image",
        mimeType: "image/png",
        storagePath: "exercise-image",
      },
    ]);

    expect(plan.steps).toHaveLength(0);
    expect(plan.conversationalResponse).toBe("La distancia correcta es 1 m.");
    expect(chatMock).toHaveBeenCalledTimes(1);

    const messages = chatMock.mock.calls[0][0];
    const userMessage = messages[1];
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content.some((part: any) => part.type === "image_url")).toBe(true);
  });
});
