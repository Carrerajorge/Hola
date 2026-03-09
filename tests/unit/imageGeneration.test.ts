import { describe, expect, it } from "vitest";

import {
  classifyImageIntent,
  detectImageRequest,
  detectVideoRequest,
  extractImagePrompt,
  extractVideoPrompt,
} from "../../server/services/imageGeneration";

describe("imageGeneration helpers", () => {
  it("detects direct image requests", () => {
    expect(detectImageRequest("crea una imagen de un perro astronauta")).toBe(true);
    expect(extractImagePrompt("crea una imagen de un perro astronauta")).toBe("un perro astronauta");
  });

  it("detects direct video requests and strips the command prefix", () => {
    expect(detectVideoRequest("crea un video de un perro corriendo en la playa")).toBe(true);
    expect(extractVideoPrompt("crea un video de un perro corriendo en la playa")).toBe(
      "un perro corriendo en la playa",
    );
    expect(detectVideoRequest("crea una video de un perro")).toBe(true);
    expect(extractVideoPrompt("crea una video de un perro")).toBe("un perro");
  });

  it("classifies image edits when recent image context exists", () => {
    expect(classifyImageIntent("edita esta imagen y ponle un sombrero", true).mode).toBe("edit_last");
    expect(classifyImageIntent("genera una imagen de una ciudad futurista", false).mode).toBe("generate");
  });
});
