import { describe, expect, it } from "vitest";
import { generatePptDocument } from "../documentGeneration";

describe("documentGeneration PPT", () => {
  it("generates a valid PPTX buffer in ESM runtime", async () => {
    const buffer = await generatePptDocument("Prueba PPT", [
      { title: "Portada", content: ["Introducción"] },
      { title: "Contenido", content: ["Punto 1", "Punto 2"] },
    ]);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1024);
    // PPTX is a ZIP container.
    expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
  });
});
