import { describe, expect, it } from "vitest";
import { deriveSkillOperationalProfile } from "./skillOperationalProfile";

describe("deriveSkillOperationalProfile", () => {
  it("classifies github-like skills as engineering operations", () => {
    const profile = deriveSkillOperationalProfile({
      id: "github",
      name: "GitHub",
      description: "Gestiona repositorios, PRs y CI/CD.",
      category: "integrations",
      features: ["Gestion de repos", "Revisiones de codigo"],
      builtIn: true,
      enabled: true,
    });

    expect(profile.badgeLabel).toBe("EngOps");
    expect(profile.domainLabel).toContain("Ingenieria");
    expect(profile.requirements.join(" ")).toContain("repositorio");
    expect(profile.orchestrator.primaryTools).toContain("generate_code");
    expect(profile.orchestrator.executionMode).toBe("hybrid");
  });

  it("falls back to category defaults when there is no domain override", () => {
    const profile = deriveSkillOperationalProfile({
      id: "mi-skill-interna",
      name: "Mi skill interna",
      description: "Hace una tarea especializada.",
      category: "custom",
      features: [],
      builtIn: false,
      enabled: true,
    });

    expect(profile.badgeLabel).toBe("SpecialOps");
    expect(profile.abilityHighlights.length).toBeGreaterThan(0);
    expect(profile.modeChip).toBe("Especializado");
    expect(profile.orchestrator.runtimeLabel).toBe("Skill Platform");
  });

  it("derives document operations for spreadsheet skills", () => {
    const profile = deriveSkillOperationalProfile({
      id: "xlsx",
      name: "Excel",
      description: "Analiza hojas de calculo.",
      category: "documents",
      features: ["Formulas", "Graficos"],
      builtIn: true,
      enabled: true,
    });

    expect(profile.badgeLabel).toBe("DocOps");
    expect(profile.outputSurface).toContain("artefactos");
    expect(profile.executionPhases).toHaveLength(3);
    expect(profile.orchestrator.primaryTools).toEqual(
      expect.arrayContaining(["create_spreadsheet", "analyze_data"]),
    );
  });

  it("routes automation skills through the orchestrator lane", () => {
    const profile = deriveSkillOperationalProfile({
      id: "spawn_subagent",
      name: "Nested Subagents (Clawi Integration)",
      description: "Delega rutinas complejas en subagentes.",
      category: "automation",
      features: ["Delegacion", "Paralelismo"],
      builtIn: true,
      enabled: true,
    });

    expect(profile.badgeLabel).toBe("AgentOps");
    expect(profile.orchestrator.lane).toBe("brain");
    expect(profile.orchestrator.primaryTools).toEqual(
      expect.arrayContaining(["openclaw_spawn_subagent", "openclaw_subagent_status"]),
    );
  });
});
