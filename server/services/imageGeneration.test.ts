import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContentMock = vi.fn();
const generateImagesMock = vi.fn();
const openAiImagesGenerateMock = vi.fn();
const openAiChatCreateMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: generateContentMock,
      generateImages: generateImagesMock,
    };
  },
}));

vi.mock("openai", () => ({
  default: class {
    images = {
      generate: openAiImagesGenerateMock,
    };

    chat = {
      completions: {
        create: openAiChatCreateMock,
      },
    };
  },
}));

describe("imageGeneration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-gemini-key";
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;
    delete process.env.GEMINI_IMAGE_MODEL;
    generateContentMock.mockReset();
    generateImagesMock.mockReset();
    openAiImagesGenerateMock.mockReset();
    openAiChatCreateMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses gemini-3.1-flash-image-preview by default", async () => {
    generateContentMock.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: "ZmFrZS1pbWFnZS1ieXRlcw==",
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    });

    const { generateImage } = await import("./imageGeneration");
    const result = await generateImage("crea una imagen de un perro");

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-flash-image-preview",
      }),
    );
    expect(result.model).toBe("gemini-3.1-flash-image-preview");
    expect(result.prompt).toBe("un perro");
  });

  it("normalizes provider-prefixed Gemini model ids before calling the Gemini SDK", async () => {
    generateContentMock.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: "ZmFrZS1pbWFnZS1ieXRlcw==",
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    });

    const { generateImage } = await import("./imageGeneration");
    const result = await generateImage("crea una imagen de un perro", {
      preferredModel: "google/gemini-3.1-flash-image-preview",
    });

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-flash-image-preview",
      }),
    );
    expect(result.model).toBe("gemini-3.1-flash-image-preview");
  });

  it("falls back to generateImages-compatible Imagen models when Gemini content models fail", async () => {
    generateContentMock.mockRejectedValue(new Error("unsupported"));
    generateImagesMock.mockResolvedValueOnce({
      generatedImages: [
        {
          image: {
            imageBytes: "ZmFrZS1pbWFnZS1ieXRlcw==",
            mimeType: "image/png",
          },
        },
      ],
    });

    const { generateImage } = await import("./imageGeneration");
    const result = await generateImage("un perro");

    expect(generateImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "imagen-4.0-fast-generate-001",
        prompt: "un perro",
      }),
    );
    expect(result.model).toBe("imagen-4.0-fast-generate-001");
  });

  it("normalizes bare Gemini model ids before using the OpenRouter fallback", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    openAiChatCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            images: [
              {
                image_url: {
                  url: "data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==",
                },
              },
            ],
          },
        },
      ],
    });

    const { generateImage } = await import("./imageGeneration");
    const result = await generateImage("un perro", {
      preferredModel: "gemini-3.1-flash-image-preview",
    });

    expect(openAiChatCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "google/gemini-3.1-flash-image-preview",
      }),
    );
    expect(result.model).toBe("google/gemini-3.1-flash-image-preview");
  });

  it("uses bytedance-seed/seed-2.0-mini as the default video planner and falls back cleanly when OpenRouter auth fails", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    openAiChatCreateMock.mockRejectedValueOnce(new Error("401 User not found."));
    generateContentMock.mockImplementation(async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: "ZmFrZS1pbWFnZS1ieXRlcw==",
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    }));

    const { generateVideoStoryboardFrames } = await import("./imageGeneration");
    const result = await generateVideoStoryboardFrames("crea un video de un perro");

    expect(openAiChatCreateMock).toHaveBeenCalledTimes(1);
    expect(openAiChatCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "bytedance-seed/seed-2.0-mini",
      }),
    );
    expect(result.plannerModel).toBe("bytedance-seed/seed-2.0-mini");
    expect(result.prompt).toBe("un perro");
    expect(result.frames).toHaveLength(3);
    expect(generateContentMock).toHaveBeenCalledTimes(3);
    expect(result.frames.every((frame) => frame.model === "gemini-3.1-flash-image-preview")).toBe(true);
  });
});
