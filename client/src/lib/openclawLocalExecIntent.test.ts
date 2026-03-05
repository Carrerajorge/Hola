import { describe, expect, it } from "vitest";
import { isOpenClawLocalExecIntent } from "./openclawLocalExecIntent";

describe("isOpenClawLocalExecIntent", () => {
  it("detects strict audit prompt that requests openclaw_clawi_status execution", () => {
    const prompt =
      "Modo auditoria estricto. Si no puedes usar herramientas openclaw_* de verdad, responde exactamente FAIL_NO_OPENCLAW_TOOLS y termina. Tarea obligatoria: ejecuta openclaw_clawi_status y responde JSON.";
    expect(isOpenClawLocalExecIntent(prompt)).toBe(true);
  });

  it("detects bare openclaw command form", () => {
    expect(isOpenClawLocalExecIntent("openclaw_clawi_status")).toBe(true);
  });

  it("detects command with inline JSON payload", () => {
    const prompt = 'openclaw_clawi_exec {"args":["agent","--mode","rpc","--json"]}';
    expect(isOpenClawLocalExecIntent(prompt)).toBe(true);
  });

  it("detects strict audit prompt even without explicit execution verb", () => {
    const prompt =
      "Modo auditoria estricto. Tarea obligatoria: herramienta openclaw_clawi_status. Responde exactamente FAIL_NO_OPENCLAW_TOOLS si no puedes.";
    expect(isOpenClawLocalExecIntent(prompt)).toBe(true);
  });

  it("detects step-by-step prompt with openclaw tool mention", () => {
    const prompt =
      "Instrucciones: 1) openclaw_clawi_status 2) guarda salida en JSON 3) resume hallazgos.";
    expect(isOpenClawLocalExecIntent(prompt)).toBe(true);
  });

  it("returns false for generic non-local requests", () => {
    expect(isOpenClawLocalExecIntent("crea una presentacion de gestion administrativa")).toBe(false);
  });
});
