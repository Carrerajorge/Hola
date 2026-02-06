import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { llmGateway } from "./llmGateway";

export class StructuredOutputError extends Error {
  readonly rawOutput: string;
  readonly causeMessage?: string;
  readonly attempts: number;

  constructor(message: string, args: { rawOutput: string; attempts: number; causeMessage?: string }) {
    super(message);
    this.name = "StructuredOutputError";
    this.rawOutput = args.rawOutput;
    this.causeMessage = args.causeMessage;
    this.attempts = args.attempts;
  }
}

function extractFirstJsonObject(text: string): string | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  // Fast-path: already looks like JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  // Heuristic: grab the first {...} or [...] block.
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");

  let start = -1;
  let endChar = "}";

  if (firstBrace === -1 && firstBracket === -1) return null;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    endChar = "}";
  } else {
    start = firstBracket;
    endChar = "]";
  }

  const end = trimmed.lastIndexOf(endChar);
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function buildSchemaPrompt(schema: unknown): string {
  // Keep prompt compact; models behave better with smaller schemas.
  const raw = JSON.stringify(schema, null, 0);
  if (raw.length <= 12_000) return raw;
  return raw.slice(0, 12_000) + "...";
}

export async function generateStructuredOutput<T>(
  args: {
    messages: ChatCompletionMessageParam[];
    schema: ZodSchema<T>;
    schemaName: string;
    model?: string;
    provider?: "xai" | "gemini" | "auto";
    temperature?: number;
    maxTokens?: number;
    userId?: string;
    requestId?: string;
    maxRetries?: number;
    timeoutMs?: number;
  }
): Promise<{ value: T; raw: string; attempts: number }> {
  const {
    messages,
    schema,
    schemaName,
    model,
    provider = "auto",
    temperature = 0.1,
    maxTokens = 1200,
    userId,
    requestId,
    maxRetries = 2,
    timeoutMs,
  } = args;

  const jsonSchema = zodToJsonSchema(schema, { name: schemaName });
  const schemaSnippet = buildSchemaPrompt(jsonSchema);

  const system: ChatCompletionMessageParam = {
    role: "system",
    content:
      `Return ONLY a valid JSON value that conforms to the provided JSON Schema.\n` +
      `Do not include markdown fences, explanations, or extra keys.\n` +
      `If you are uncertain, use nulls/empty arrays but keep the required shape.\n\n` +
      `JSON Schema:\n${schemaSnippet}`,
  };

  let lastRaw = "";
  let lastCause = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptMessages: ChatCompletionMessageParam[] =
      attempt === 0
        ? [system, ...messages]
        : [
            system,
            ...messages,
            {
              role: "system",
              content:
                `The previous output did not validate.\n` +
                `Validation/parse error: ${lastCause}\n` +
                `Output a corrected JSON value ONLY.`,
            },
            { role: "assistant", content: lastRaw },
          ];

    const response = await llmGateway.chat(attemptMessages, {
      model,
      provider,
      temperature,
      maxTokens,
      userId,
      requestId,
      timeout: timeoutMs,
      enableFallback: true,
      skipCache: true,
    });

    lastRaw = response.content || "";
    const jsonText = extractFirstJsonObject(lastRaw);
    if (!jsonText) {
      lastCause = "No JSON object/array found in output";
      continue;
    }

    try {
      const parsed = JSON.parse(jsonText);
      const validated = schema.parse(parsed);
      return { value: validated, raw: jsonText, attempts: attempt + 1 };
    } catch (err: any) {
      lastCause = err?.message || String(err);
      continue;
    }
  }

  throw new StructuredOutputError(`Failed to produce structured output for ${schemaName}`, {
    rawOutput: lastRaw,
    attempts: maxRetries + 1,
    causeMessage: lastCause,
  });
}

