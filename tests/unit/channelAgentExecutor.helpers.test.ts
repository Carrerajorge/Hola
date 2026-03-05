import { describe, expect, it } from "vitest";
import { __channelAgentExecutorInternals } from "../../server/channels/channelAgentExecutor";

describe("channelAgentExecutor internals", () => {
  it("detects explicit word-document requests", () => {
    expect(__channelAgentExecutorInternals.shouldAutoGenerateWordDocument("puedes crear un Word y mandarmelo")).toBe(true);
    expect(__channelAgentExecutorInternals.shouldAutoGenerateWordDocument("resuelve este ejercicio")).toBe(false);
  });

  it("builds title from chat title first", () => {
    const title = __channelAgentExecutorInternals.buildAutoWordTitle("Matematicas Avanzadas", "crea un word sobre integrales");
    expect(title).toBe("Matematicas Avanzadas");
  });

  it("decodes artifact base64 payloads", () => {
    const encoded = Buffer.from("hola mundo", "utf-8").toString("base64");
    const decoded = __channelAgentExecutorInternals.decodeArtifactData({
      base64: encoded,
      mimeType: "text/plain",
      filename: "salida.txt",
    });

    expect(decoded).not.toBeNull();
    expect(decoded?.mimeType).toBe("text/plain");
    expect(decoded?.fileName).toBe("salida.txt");
    expect(decoded?.buffer.toString("utf-8")).toBe("hola mundo");
  });

  it("infers generated file types from extension", () => {
    expect(__channelAgentExecutorInternals.inferGeneratedFileType("archivo.docx")).toBe("document");
    expect(__channelAgentExecutorInternals.inferGeneratedFileType("tabla.xlsx")).toBe("spreadsheet");
    expect(__channelAgentExecutorInternals.inferGeneratedFileType("imagen.png")).toBe("image");
    expect(__channelAgentExecutorInternals.inferGeneratedFileType("otro.bin")).toBe("other");
  });
});
