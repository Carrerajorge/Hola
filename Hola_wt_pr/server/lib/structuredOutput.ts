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

function extractFirstJsonValue(text: string): string | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const tryParse = (candidate: string): string | null => {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  };

  // Fast-path: output is pure JSON already.
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && tryParse(trimmed)) {
    return trimmed;
  }

  const extractFrom = (start: number): string | null => {
    const open = trimmed[start];
    const close = open === "{" ? "}" : open === "[" ? "]" : null;
    if (!close) return null;

    const stack: string[] = [open];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }

      if (ch === "}" || ch === "]") {
        const last = stack.pop();
        if (!last) return null;
        const expected = last === "{" ? "}" : "]";
        if (ch !== expected) return null;

        if (stack.length === 0) {
          return trimmed.slice(start, i + 1);
        }
      }
    }

    return null;
  };

  // Scan for the first parseable {...} or [...] substring.
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") continue;
    const candidate = extractFrom(i);
    if (!candidate) continue;
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  return null;
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
    const jsonText = extractFirstJsonValue(lastRaw);
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
