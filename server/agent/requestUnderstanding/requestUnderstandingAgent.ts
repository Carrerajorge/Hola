import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { llmGateway } from "../../lib/llmGateway";
import { Logger } from "../../lib/logger";
import { RequestBriefSchema, type RequestBrief } from "./briefSchema";

export type RequestUnderstandingInput = {
  text: string;
  // Future: normalized docs/images go here
  attachments?: Array<{ type: "document" | "image"; name?: string; extractedText: string }>;
  userId?: string;
  requestId?: string;
};

function buildPrompt(input: RequestUnderstandingInput): ChatCompletionMessageParam[] {
  const attachments = input.attachments?.length
    ? input.attachments
        .map((a, i) => `ATTACHMENT[${i + 1}] (${a.type}) ${a.name ?? ""}\n${a.extractedText}`)
        .join("\n\n")
    : "(none)";

  const system = `You are a Request-Understanding Agent.
You MUST output a single JSON object that strictly matches the schema below.
No markdown. No commentary. No wrapping in code blocks.

REQUIRED JSON SCHEMA:
{
  "intent": { "primary_intent": "string", "confidence": 0.0-1.0 },
  "subtasks": [
    { "title": "string", "description": "string", "priority": "high"|"medium"|"low" }
  ],
  "deliverable": { "description": "string", "format": "string" },
  "audience": { "audience": "string", "tone": "string", "language": "es" },
  "restrictions": [{ "constraint": "string", "hard": true|false }],
  "data_provided": [{ "key": "string", "value": "any", "source": "provided"|"extracted"|"assumed" }],
  "assumptions": ["string"],
  "success_criteria": ["string"],
  "risks": [{ "risk": "string", "severity": "low"|"medium"|"high"|"critical" }],
  "ambiguities": ["string"],
  "blocker": { "is_blocked": false, "question": "" }
}

Rules:
- Build a canonical brief for the request.
- Extract constraints like: "sin buscar", "sin fuentes", budgets, approvals.
- Identify what data is provided vs assumed.
- If blocked, set blocker.is_blocked=true and provide EXACTLY ONE clarification question in blocker.question.
- Subtasks MUST be 2 to 5. Each subtask MUST have "title", "description", and "priority".
- data_provided items MUST have "key", "value", and "source".
- Keep it minimal and professional.`;

  const user = `INPUT_TEXT:\n${input.text}\n\nATTACHMENTS_EXTRACTED:\n${attachments}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export class RequestUnderstandingAgent {
  async buildBrief(input: RequestUnderstandingInput): Promise<RequestBrief> {
    const messages = buildPrompt(input);

    const requestId = input.requestId ?? `ru_${Date.now()}`;

    const maxRetries = 2;
    let lastErr: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await llmGateway.chat(messages, {
          requestId,
          userId: input.userId,
          temperature: 0,
          // keep response small-ish
          maxTokens: 1200,
          enableFallback: true,
        });

        let raw = (res.content || "").trim();
        // Strip markdown code blocks if LLM wraps output
        if (raw.startsWith("```")) {
          raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        const json = JSON.parse(raw);
        const brief = RequestBriefSchema.parse(json);

        // Hard normalization: if blocked, enforce single question
        if (brief.blocker?.is_blocked) {
          brief.blocker.question = (brief.blocker.question || "").trim();
          if (!brief.blocker.question) {
            brief.blocker.question = "¿Qué información falta para poder completar el encargo?";
          }
        }

        return brief;
      } catch (err: any) {
        lastErr = err;
        Logger.warn(`[RequestUnderstanding] brief parse failed attempt=${attempt + 1}: ${err?.message || err}`);

        // Add repair instruction (append to messages)
        messages.push({ role: "assistant", content: "{\"error\":\"previous_output_invalid\"}" });
        messages.push({
          role: "user",
          content:
            `Your output was invalid. Return ONLY valid JSON matching the schema. Error: ${err?.message || err}`,
        });
      }
    }

    throw lastErr;
  }
}

export const requestUnderstandingAgent = new RequestUnderstandingAgent();
