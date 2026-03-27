import { describe, expect, it } from "vitest";
import { classifyImageIntent } from "../../server/services/imageGeneration";

describe("classifyImageIntent", () => {
  it("defaults to generate for new image prompts", () => {
    expect(classifyImageIntent("crea una imagen de un gato futurista", false, false)).toEqual({
      mode: "generate",
      reason: "new_generation",
    });
  });

  it("uses edit_last when the prompt asks to modify the previous image", () => {
    expect(classifyImageIntent("edita la imagen anterior y hazla azul", true, false)).toEqual({
      mode: "edit_last",
      reason: "last_image_context",
    });
  });

  it("prefers edit_specific when a specific image context is provided", () => {
    expect(classifyImageIntent("haz esta imagen más nítida", true, true)).toEqual({
      mode: "edit_specific",
      reason: "specific_image_context",
    });
  });
});
