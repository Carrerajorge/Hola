import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { zodToJsonSchema } from "zod-to-json-schema";
import { llmGateway } from "../../lib/llmGateway";
import { Logger } from "../../lib/logger";
import type { RequestBrief } from "../requestUnderstanding";
import { VerifierResultSchema, type VerifierResult } from "./verifierSchema";

export type VerifierInput = {
  brief: RequestBrief;
  answer: string;
  evidenceText?: string;
  userId?: string;
  requestId?: string;
};

const VerifierJsonSchema = zodToJsonSchema(VerifierResultSchema, {
  name: "VerifierResult",
});

function extractJsonObject(text: string): unknown {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Empty LLM output");

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("No JSON object found in LLM output");
    }
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }
}

function fallbackVerification(reason?: string): VerifierResult {
  return VerifierResultSchema.parse({
    is_coherent: true,
    confidence: 0.5,
    contradictions: [],
    missing_citations: [],
    issues: reason ? [{ issue: `Verifier fallback: ${reason}`, severity: "low", evidence: [] }] : [],
    should_ask_clarifying_question: false,
    notes: [],
  });
}

function buildPrompt(input: VerifierInput): ChatCompletionMessageParam[] {
  const evidence = (input.evidenceText || "").trim();

  const system = `Eres un modelo Verifier/QA separado.
Tu trabajo es validar coherencia y trazabilidad (citas) de una respuesta final.
Salida: UN SOLO objeto JSON que cumpla el schema. Sin markdown. Sin texto extra.

Reglas:
- Verifica coherencia interna: fechas, numeros, unidades, contradicciones.
- Verifica consistencia con la evidencia provista (documentos, imagenes, contexto recuperado).
- Citas: si se usa evidencia, exige citas por doc/pagina/seccion/imagen segun el formato [doc:... p#] o equivalente.
- Si falta informacion critica para cerrar el encargo: should_ask_clarifying_question=true y UNA SOLA pregunta en clarifying_question.
- Si no hace falta preguntar, should_ask_clarifying_question=false y NO agregues preguntas en clarifying_question.`;

  const user = `REQUEST_BRIEF (JSON):\n${JSON.stringify(input.brief)}\n\nANSWER_TO_VERIFY:\n${input.answer}\n\nEVIDENCE (may be empty):\n${evidence || "(none)"}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export class VerifierAgent {
  async verifyAnswer(input: VerifierInput): Promise<VerifierResult> {
    const messages = buildPrompt(input);
    const requestId = input.requestId ?? `verify_${Date.now()}`;

    const responseFormats: Array<{ label: string; value?: unknown }> = [
      {
        label: "json_schema",
        value: {
          type: "json_schema",
          json_schema: {
            name: "VerifierResult",
            schema: VerifierJsonSchema,
            strict: true,
          },
        },
      },
      { label: "json_object", value: { type: "json_object" } },
      { label: "none" },
    ];

    let lastErr: any;

    for (const rf of responseFormats) {
      const maxRetries = 1;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await llmGateway.chat(messages, {
            requestId,
            userId: input.userId,
            temperature: 0,
            maxTokens: 900,
            enableFallback: true,
            responseFormat: rf.value,
          });

          const raw = (res.content || "").trim();
          const json = extractJsonObject(raw);
          const verification = VerifierResultSchema.parse(json);

          if (verification.should_ask_clarifying_question) {
            verification.clarifying_question = (verification.clarifying_question || "").trim();
            if (!verification.clarifying_question) {
              verification.clarifying_question = "Que informacion falta para poder cerrar el encargo con confianza?";
            }
          } else {
            verification.clarifying_question = undefined;
          }

          return verification;
        } catch (err: any) {
          lastErr = err;
          Logger.warn(
            `[Verifier] verification failed format=${rf.label} attempt=${attempt + 1}: ${err?.message || err}`
          );

          messages.push({ role: "assistant", content: "{\"error\":\"previous_output_invalid\"}" });
          messages.push({
            role: "user",
            content: `Salida invalida. Devuelve SOLO JSON valido que cumpla el schema. Error: ${err?.message || err}`,
          });
        }
      }
    }

    return fallbackVerification(lastErr?.message || String(lastErr || "unknown"));
  }
}

export const verifierAgent = new VerifierAgent();

