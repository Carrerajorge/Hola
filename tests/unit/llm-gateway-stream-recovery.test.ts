import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../../server/lib/llmGateway";

const baseMessages: ChatCompletionMessageParam[] = [
  { role: "user", content: "hola" },
];

async function collectStream(
  messages: ChatCompletionMessageParam[],
  options: Record<string, unknown>,
) {
  const chunks: Array<{
    content: string;
    sequenceId: number;
    done: boolean;
    requestId: string;
    provider?: string;
  }> = [];

  for await (const chunk of llmGateway.streamChat(messages, options as any)) {
    chunks.push(chunk as any);
  }

  return chunks;
}

describe("llmGateway stream empty-response recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(llmGateway as any, "getSmartRoutedProviders").mockReturnValue([
      "openrouter",
    ]);
    vi.spyOn(llmGateway as any, "isProviderReady").mockReturnValue(true);
    vi.spyOn(llmGateway as any, "selectProvider").mockReturnValue("openrouter");
    vi.spyOn(llmGateway as any, "checkRateLimit").mockReturnValue(true);
    vi.spyOn(llmGateway, "truncateContext").mockImplementation(
      (messages) =>
        ({
          messages,
          truncationApplied: false,
          originalTokens: 8,
          finalTokens: 8,
          droppedMessages: 0,
          truncatedMessageCount: 0,
        }) as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers an empty pinned-provider stream with a same-provider non-stream completion", async () => {
    const streamSpy = vi
      .spyOn(llmGateway as any, "streamOpenAICompatible")
      .mockImplementation(async function* () {
        yield { content: "", done: true };
      });
    const executeSpy = vi
      .spyOn(llmGateway as any, "executeOnProviderNoBreaker")
      .mockResolvedValue({
        content: "Hola. ¿En qué puedo ayudarte?",
        requestId: "req_stream_recover",
        latencyMs: 14,
        model: "openrouter/moonshotai/kimi-k2.5",
        provider: "openrouter",
      });

    const streamRecoveriesBefore = llmGateway.getMetrics().streamRecoveries;

    const chunks = await collectStream(baseMessages, {
      requestId: "req_stream_recover",
      provider: "openrouter",
      model: "openrouter/moonshotai/kimi-k2.5",
    });

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      content: "Hola. ¿En qué puedo ayudarte?",
      done: false,
      requestId: "req_stream_recover",
      provider: "openrouter",
      sequenceId: 0,
    });
    expect(chunks[1]).toMatchObject({
      content: "",
      done: true,
      requestId: "req_stream_recover",
      provider: "openrouter",
      sequenceId: 1,
    });
    expect(llmGateway.getMetrics().streamRecoveries).toBe(
      streamRecoveriesBefore + 1,
    );
  });

  it("preserves the original empty-stream failure when same-provider recovery is also empty", async () => {
    vi.spyOn(llmGateway as any, "streamOpenAICompatible").mockImplementation(
      async function* () {
        yield { content: "", done: true };
      },
    );
    vi.spyOn(llmGateway as any, "executeOnProviderNoBreaker").mockResolvedValue({
      content: "   ",
      requestId: "req_stream_empty",
      latencyMs: 9,
      model: "openrouter/moonshotai/kimi-k2.5",
      provider: "openrouter",
    });

    await expect(
      collectStream(baseMessages, {
        requestId: "req_stream_empty",
        provider: "openrouter",
        model: "openrouter/moonshotai/kimi-k2.5",
      }),
    ).rejects.toThrow("Empty streamed response from provider openrouter");
  });
});
