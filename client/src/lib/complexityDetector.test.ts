import { describe, it, expect } from "vitest";
import {
  checkComplexityLocally,
  checkComplexityWithApi,
  shouldAutoActivateAgent,
} from "./complexityDetector";

describe("checkComplexityLocally", () => {
  it("returns not required for trivial greetings", () => {
    expect(checkComplexityLocally("hola").agent_required).toBe(false);
    expect(checkComplexityLocally("hi!").agent_required).toBe(false);
    expect(checkComplexityLocally("thanks").agent_required).toBe(false);
    expect(checkComplexityLocally("ok").agent_required).toBe(false);
    expect(checkComplexityLocally("sí").agent_required).toBe(false);
    expect(checkComplexityLocally("bye").agent_required).toBe(false);
  });

  it("returns high confidence for trivial messages", () => {
    const result = checkComplexityLocally("hola");
    expect(result.confidence).toBe("high");
  });

  it("returns not required for short messages (< 10 chars)", () => {
    expect(checkComplexityLocally("hey").agent_required).toBe(false);
    expect(checkComplexityLocally("yes!").agent_required).toBe(false);
  });

  it("returns required for explicit agent request", () => {
    const result = checkComplexityLocally("usa el agente para buscar información");
    expect(result.agent_required).toBe(true);
    expect(result.agent_reason).toBe("Solicitud de agente");
    expect(result.confidence).toBe("high");
  });

  it("returns required for 'agent mode' request", () => {
    const result = checkComplexityLocally("activa el modo agente por favor");
    expect(result.agent_required).toBe(true);
  });

  it("returns required for 'use agent' in English", () => {
    const result = checkComplexityLocally("please use agent to help me with this");
    expect(result.agent_required).toBe(true);
  });

  it("keeps general explanatory prompts in normal chat", () => {
    const result = checkComplexityLocally(
      "Explícame detalladamente cómo funciona la fotosíntesis y cuáles son las etapas principales del proceso bioquímico"
    );
    expect(result.agent_required).toBe(false);
    expect(result.confidence).toBe("high");
  });

  it("detects clear coding/tool requests", () => {
    const result = checkComplexityLocally("revisa este repo, corrige el bug y ejecuta npm test");
    expect(result.agent_required).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("keeps tutoring prompts out of agent mode", () => {
    const result = checkComplexityLocally("dame un ejercicio de derivadas con integrales");
    expect(result.agent_required).toBe(false);
    expect(result.confidence).toBe("high");
  });

  it("handles empty string", () => {
    const result = checkComplexityLocally("");
    expect(result.agent_required).toBe(false);
    expect(result.confidence).toBe("high");
  });

  it("activates agent mode for attachments only when present", () => {
    const withAttach = checkComplexityLocally("Analiza este archivo", true);
    const withoutAttach = checkComplexityLocally("Analiza este archivo", false);
    expect(withAttach.agent_required).toBe(true);
    expect(withAttach.agent_reason).toBe("Modo agente por adjuntos");
    expect(withoutAttach.agent_required).toBe(false);
  });
});

describe("checkComplexityWithApi", () => {
  it("delegates to local check", async () => {
    const result = await checkComplexityWithApi("hola");
    expect(result.agent_required).toBe(false);
  });

  it("detects explicit agent request", async () => {
    const result = await checkComplexityWithApi("usa el agente para buscar datos");
    expect(result.agent_required).toBe(true);
  });
});

describe("shouldAutoActivateAgent", () => {
  it("delegates to local check", () => {
    const result = shouldAutoActivateAgent("hola");
    expect(result.agent_required).toBe(false);
  });

  it("detects explicit agent request", () => {
    const result = shouldAutoActivateAgent("con el agente analiza los datos");
    expect(result.agent_required).toBe(true);
  });
});
