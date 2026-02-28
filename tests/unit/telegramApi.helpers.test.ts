import { describe, expect, it } from "vitest";
import { __telegramApiInternals } from "../../server/channels/telegram/telegramApi";

describe("telegramApi internals", () => {
  it("preserves line breaks in text normalization", () => {
    const normalized = __telegramApiInternals.normalizeTelegramText("Linea 1\r\nLinea 2");
    expect(normalized).toBe("Linea 1\nLinea 2");
  });

  it("cleans markdown artifacts and improves simple math in plain fallback", () => {
    const raw = "La opción *)a)* establece que:**h = (SA + 2s2) / 4**";
    const cleaned = __telegramApiInternals.normalizePlainFallbackText(raw);

    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("*");
    expect(cleaned).toContain("h = (SA + 2s²) / 4");
  });
});
