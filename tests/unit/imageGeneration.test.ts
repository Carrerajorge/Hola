import { describe, expect, it } from "vitest";

import {
  detectImageRequest,
  detectVideoRequest,
  extractImagePrompt,
  extractVideoPrompt,
} from "../../server/services/imageGeneration";

describe("imageGeneration helpers", () => {
  it("detects direct image requests", () => {
    expect(detectImageRequest("crea una imagen de un perro astronauta")).toBe(true);
    expect(extractImagePrompt("crea una imagen de un perro astronauta")).toBe(
      "un perro astronauta",
    );
  });

  it("detects direct video requests and strips the command prefix when possible", () => {
    expect(detectVideoRequest("crea un video de un perro corriendo en la playa")).toBe(true);
    expect(extractVideoPrompt("crea un video de un perro corriendo en la playa")).toBe(
      "un perro corriendo en la playa",
    );
    expect(detectVideoRequest("quiero un video de un perro")).toBe(true);
    expect(extractVideoPrompt("quiero un video de un perro")).toBe(
      "quiero un video de un perro",
    );
  });
});
