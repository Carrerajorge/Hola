import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { llmGateway } from "../../server/lib/llmGateway";

describe("llmGateway OpenAI Responses support", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    llmGateway.destroy();
  });

  it("routes gpt-5.x requests through the OpenAI Responses API", async () => {
    const gateway = llmGateway as any;
    const responsesCreate = vi.fn().mockResolvedValue({
      output_text: "Hola desde Responses",
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        total_tokens: 19,
      },
    });
    const chatCreate = vi.fn();

    vi.spyOn(gateway, "getOpenAICompatibleClient").mockReturnValue({
      responses: { create: responsesCreate },
      chat: { completions: { create: chatCreate } },
    } as any);
    vi.spyOn(gateway, "recordTokenUsage").mockImplementation(() => {});
    vi.spyOn(gateway, "persistApiLog").mockImplementation(() => {});

    const result = await gateway.executeOpenAICompatible(
      "openai",
      [{ role: "user", content: "Hola" }],
      {
        requestId: "req_test_openai_responses",
        userId: "u_test",
        timeout: 5_000,
        model: "gpt-5.5",
      },
      "gpt-5.5",
      Date.now(),
    );

    expect(chatCreate).not.toHaveBeenCalled();
    expect(responsesCreate).toHaveBeenCalledOnce();
    expect(result.provider).toBe("openai");
    expect(result.content).toBe("Hola desde Responses");
    expect(result.usage).toEqual({
      promptTokens: 12,
      completionTokens: 7,
      totalTokens: 19,
    });
  });

  it("streams deltas from the OpenAI Responses API for gpt-5.x models", async () => {
    const gateway = llmGateway as any;
    const responsesCreate = vi.fn().mockResolvedValue((async function* () {
      yield { type: "response.output_text.delta", delta: "Hola" };
      yield { type: "response.output_text.delta", delta: " mundo" };
      yield { type: "response.completed" };
    })());

    vi.spyOn(gateway, "getOpenAICompatibleClient").mockReturnValue({
      responses: { create: responsesCreate },
      chat: { completions: { create: vi.fn() } },
    } as any);

    const chunks: string[] = [];
    for await (const chunk of gateway.streamOpenAICompatible(
      "openai",
      [{ role: "user", content: "Hola" }],
      { requestId: "req_stream_openai_responses", model: "gpt-5.5", timeout: 5_000 },
      "req_stream_openai_responses",
    )) {
      chunks.push(chunk.content);
    }

    expect(responsesCreate).toHaveBeenCalledOnce();
    expect(chunks).toEqual(["Hola", " mundo", ""]);
  });
});
