import { describe, expect, it } from "vitest";
import { __channelIngestServiceInternals } from "../../server/channels/channelIngestService";

describe("channelIngestService internals", () => {
  it("preserves line breaks and tabs while removing unsafe controls", () => {
    const input = "Linea 1\n\t- item\r\nLinea 2\x00";
    const sanitized = __channelIngestServiceInternals.sanitizeOutboundRichText(input);

    expect(sanitized).toContain("Linea 1\n\t- item\nLinea 2");
    expect(sanitized).not.toContain("\x00");
  });

  it("detects explicit Word document requests", () => {
    expect(__channelIngestServiceInternals.shouldAutoGenerateWordDocument("puedes crear un word y mandarmelo")).toBe(true);
    expect(__channelIngestServiceInternals.shouldAutoGenerateWordDocument("resuelve este ejercicio")).toBe(false);
  });

  it("builds automatic Word title from conversation title when present", () => {
    const title = __channelIngestServiceInternals.buildAutoWordTitle({
      conversation: { title: "Matematicas Avanzadas" },
      envelope: { text: "crea un word sobre integrales" },
    } as any);

    expect(title).toBe("Matematicas Avanzadas");
  });
});
