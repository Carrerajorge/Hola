import { describe, expect, test, vi } from "vitest";

import { requestUnderstandingAgent } from "../requestUnderstandingAgent";
import { llmGateway } from "../../../lib/llmGateway";

// Mock llmGateway.chat to produce deterministic structured JSON
vi.spyOn(llmGateway, "chat").mockImplementation(async () => {
  return {
    content: JSON.stringify({
      intent: { primary_intent: "Crear un brief", confidence: 0.9 },
      subtasks: [
        { title: "Entender", description: "Entender el pedido", priority: "high" },
        { title: "Responder", description: "Responder con formato", priority: "medium" },
      ],
      deliverable: { description: "Respuesta", format: "markdown" },
      audience: { audience: "usuario", tone: "directo", language: "es" },
      restrictions: [],
      data_provided: [],
      assumptions: [],
      success_criteria: [],
      risks: [],
      ambiguities: [],
      blocker: { is_blocked: false },
    }),
  } as any;
});

describe("RequestUnderstandingAgent", () => {
  test("buildBrief returns valid brief", async () => {
    const brief = await requestUnderstandingAgent.buildBrief({ text: "hola" });
    expect(brief.intent.primary_intent).toContain("brief");
    expect(brief.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(brief.subtasks.length).toBeLessThanOrEqual(5);
  });

  test("100 schema validations (stress)", async () => {
    for (let i = 0; i < 100; i++) {
      const brief = await requestUnderstandingAgent.buildBrief({ text: `hola ${i}` });
      expect(brief.deliverable.format.length).toBeGreaterThan(0);
    }
  });
});
