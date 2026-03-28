import { describe, expect, it } from "vitest";

import { autosizeTextarea } from "./textareaAutosize";

describe("autosizeTextarea", () => {
  it("grows to the textarea scrollHeight until the max height", () => {
    const textarea = document.createElement("textarea");

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 140,
    });

    autosizeTextarea(textarea, 180);

    expect(textarea.style.height).toBe("140px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("caps the height and enables vertical scrolling when content exceeds the limit", () => {
    const textarea = document.createElement("textarea");

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 320,
    });

    autosizeTextarea(textarea, 180);

    expect(textarea.style.height).toBe("180px");
    expect(textarea.style.overflowY).toBe("auto");
  });
});
