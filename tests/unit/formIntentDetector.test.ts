import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectFormIntent, extractMentionFromPrompt } from "@/lib/formIntentDetector";
import type { FormIntentResult } from "@/lib/formIntentDetector";

// Silence console.log from the detector
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("detectFormIntent", () => {
  describe("explicit @GoogleForms mention", () => {
    it("returns high confidence when hasMention is true", () => {
      const result = detectFormIntent("create a quiz", false, true);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
      expect(result.mentionDetected).toBe(true);
      expect(result.keywordsFound).toContain("@GoogleForms");
      expect(result.suggestedAction).toBe("generate");
    });

    it("returns high confidence when prompt contains @googleforms text", () => {
      const result = detectFormIntent("@googleforms make a survey about pets", false, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
      expect(result.mentionDetected).toBe(true);
    });

    it("detects @GoogleForms mention regardless of isGoogleFormsActive", () => {
      const result = detectFormIntent("@googleforms quiz", false, false);
      expect(result.hasFormIntent).toBe(true);
    });
  });

  describe("when Google Forms is NOT active", () => {
    it("returns no intent when isGoogleFormsActive is false and no mention", () => {
      const result = detectFormIntent("crear formulario de encuesta", false, false);
      expect(result.hasFormIntent).toBe(false);
      expect(result.confidence).toBe("none");
      expect(result.suggestedAction).toBe("none");
    });
  });

  describe("exclusion patterns", () => {
    it("rejects when prompt contains 'zoom'", () => {
      const result = detectFormIntent("crear formulario para zoom meeting", true, false);
      expect(result.hasFormIntent).toBe(false);
      expect(result.confidence).toBe("none");
    });

    it("rejects when prompt contains 'teams'", () => {
      const result = detectFormIntent("hacer encuesta en teams", true, false);
      expect(result.hasFormIntent).toBe(false);
    });

    it("rejects when prompt contains 'resumen'", () => {
      const result = detectFormIntent("dame un resumen del formulario", true, false);
      expect(result.hasFormIntent).toBe(false);
    });

    it("rejects when prompt asks 'what is' a form", () => {
      const result = detectFormIntent("what is a form?", true, false);
      expect(result.hasFormIntent).toBe(false);
    });

    it("rejects when prompt asks 'explain' about forms", () => {
      const result = detectFormIntent("explain how to create a form", true, false);
      expect(result.hasFormIntent).toBe(false);
    });

    it("rejects prompts with 'summary'", () => {
      const result = detectFormIntent("give me a summary of the survey results", true, false);
      expect(result.hasFormIntent).toBe(false);
    });
  });

  describe("specific form phrases (high confidence)", () => {
    it("detects 'crear formulario' as high confidence", () => {
      const result = detectFormIntent("quiero crear formulario de satisfaccion", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
      expect(result.keywordsFound).toContain("crear formulario");
    });

    it("detects 'create survey' as high confidence", () => {
      const result = detectFormIntent("create survey about employee satisfaction", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
    });

    it("detects 'google forms' as high confidence", () => {
      const result = detectFormIntent("use google forms for this", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
    });

    it("detects 'make quiz' as high confidence", () => {
      const result = detectFormIntent("make quiz about history", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
    });

    it("detects 'nueva encuesta' as high confidence", () => {
      const result = detectFormIntent("necesito una nueva encuesta", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("high");
    });
  });

  describe("action verb + form noun combination (medium confidence)", () => {
    it("detects 'genera' + 'encuesta' as medium confidence", () => {
      const result = detectFormIntent("genera una encuesta rapida", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("medium");
      expect(result.keywordsFound).toContain("encuesta");
    });

    it("detects 'build' + 'quiz' as medium confidence", () => {
      const result = detectFormIntent("build a quiz for students", true, false);
      expect(result.hasFormIntent).toBe(true);
      expect(result.confidence).toBe("medium");
    });
  });

  describe("form noun only (low confidence, no trigger)", () => {
    it("returns low confidence for just a form noun without action verb", () => {
      const result = detectFormIntent("the formulario is ready", true, false);
      expect(result.hasFormIntent).toBe(false);
      expect(result.confidence).toBe("low");
      expect(result.keywordsFound).toContain("formulario");
      expect(result.suggestedAction).toBe("none");
    });

    it("returns low confidence for 'survey' without action verb", () => {
      const result = detectFormIntent("I saw a survey today", true, false);
      expect(result.hasFormIntent).toBe(false);
      expect(result.confidence).toBe("low");
    });
  });

  describe("no form intent at all", () => {
    it("returns none for completely unrelated prompt", () => {
      const result = detectFormIntent("tell me a joke about cats", true, false);
      expect(result.hasFormIntent).toBe(false);
      expect(result.confidence).toBe("none");
      expect(result.keywordsFound).toEqual([]);
      expect(result.suggestedAction).toBe("none");
    });

    it("returns none for empty prompt", () => {
      const result = detectFormIntent("", true, false);
      expect(result.hasFormIntent).toBe(false);
      expect(result.confidence).toBe("none");
    });
  });
});

describe("extractMentionFromPrompt", () => {
  it("detects @GoogleForms mention and returns clean prompt", () => {
    const result = extractMentionFromPrompt("@GoogleForms create a quiz");
    expect(result.hasMention).toBe(true);
    expect(result.cleanPrompt).toBe("create a quiz");
  });

  it("handles case-insensitive @googleforms", () => {
    const result = extractMentionFromPrompt("@googleforms make a survey");
    expect(result.hasMention).toBe(true);
    expect(result.cleanPrompt).toBe("make a survey");
  });

  it("returns hasMention false when no mention present", () => {
    const result = extractMentionFromPrompt("just a normal prompt");
    expect(result.hasMention).toBe(false);
    expect(result.cleanPrompt).toBe("just a normal prompt");
  });

  it("removes multiple @GoogleForms mentions", () => {
    const result = extractMentionFromPrompt("@GoogleForms create @GoogleForms survey");
    expect(result.hasMention).toBe(true);
    expect(result.cleanPrompt).toBe("create survey");
  });

  it("trims whitespace from clean prompt", () => {
    const result = extractMentionFromPrompt("  @GoogleForms   ");
    expect(result.hasMention).toBe(true);
    expect(result.cleanPrompt).toBe("");
  });
});
