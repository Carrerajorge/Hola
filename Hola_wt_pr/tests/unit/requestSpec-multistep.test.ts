import { describe, expect, it } from "vitest";
import { detectIntent } from "../../server/agent/requestSpec";

describe("requestSpec.detectIntent (multi-step research + Word)", () => {
  it("returns multi_step_task when user asks to research and create a Word document", () => {
    const msg = "Investiga sobre baterías de sodio y crea un Word con un resumen y fuentes";
    const result = detectIntent(msg, []);
    expect(result.intent).toBe("multi_step_task");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("does not force multi_step_task for plain research", () => {
    const msg = "Investiga sobre baterías de sodio";
    const result = detectIntent(msg, []);
    expect(result.intent).toBe("research");
  });

  it("does not force multi_step_task for plain document creation without research", () => {
    const msg = "Crea un Word sobre baterías de sodio";
    const result = detectIntent(msg, []);
    expect(["document_generation", "multi_step_task", "chat"]).toContain(result.intent);
  });
});
