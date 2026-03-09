import { describe, expect, it } from "vitest";
import { getToolsForIntent } from "../agentExecutor";

describe("agentExecutor tool selection", () => {
  it("includes local filesystem tools for local-computer prompts", () => {
    const tools = getToolsForIntent(
      "chat",
      "owner",
      "puedes analizar que carpetas hay en mi computadora y en mi escritorio",
    );
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("openclaw_clawi_status");
  });

  it("includes local filesystem tools for count questions with typo", () => {
    const tools = getToolsForIntent(
      "chat",
      "owner",
      "puedes decirme cuantas caprteas tengo en mi escritorio?",
    );
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("openclaw_clawi_status");
  });

  it("does not inject bundled skills by default when there is no skill signal", () => {
    const tools = getToolsForIntent("chat", "owner", "hola, dame un resumen corto");
    const names = tools.map((tool) => tool.name);

    expect(names.some((name) => name.startsWith("skill_"))).toBe(false);
  });

  it("avoids web tools for simple inline table requests even if the intent is misclassified", () => {
    const tools = getToolsForIntent(
      "document_generation",
      "owner",
      "crea una tabla de 12 filas x 8 columnas de alimentos",
    );
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("create_spreadsheet");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("fetch_url");
  });

  it("keeps web research tools for document creation when the prompt explicitly asks for sources", () => {
    const tools = getToolsForIntent(
      "document_generation",
      "owner",
      "crea un informe con fuentes web actualizadas sobre nutricion deportiva",
    );
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("create_document");
    expect(names).toContain("web_search");
    expect(names).toContain("fetch_url");
  });
});
