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

function extractCitations(answer: string): string[] {
  const t = (answer || "").trim();
  if (!t) return [];
  const hits = t.match(/\[(doc|img|image|mem):[^\]\n]+\]/gi) || [];
  // Normalize "image" -> "img" so downstream logic treats them consistently.
  return hits.map(h => h.trim().replace(/^\[image:/i, "[img:"));
}

function extractHighSignalTokens(answer: string): string[] {
  const t = (answer || "").slice(0, 12000);
  const out = new Set<string>();

  // ISO dates
  for (const m of t.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) out.add(m[0]);

  // Percentages like 12% / 12.5%
  for (const m of t.matchAll(/\b\d{1,3}(?:[.,]\d+)?%\b/g)) out.add(m[0]);

  // Currency amounts (very common in docs)
  for (const m of t.matchAll(/\b(?:USD|EUR|ARS|CLP|COP|MXN|BRL)\s*[\d,.]+/gi)) out.add(m[0]);

  // Large numbers (4+ digits) or grouped thousands (1,250)
  for (const m of t.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g)) out.add(m[0]);
  for (const m of t.matchAll(/\b\d{4,}\b/g)) out.add(m[0]);

  return [...out].slice(0, 30);
}

function applyDeterministicChecks(verification: VerifierResult, input: VerifierInput): VerifierResult {
  const evidence = (input.evidenceText || "").trim();
  const answer = (input.answer || "").trim();

  if (!evidence || !answer) return verification;

  const citations = extractCitations(answer);
  const hasQuestionMark = /\?\s*$|\?\s*\n/.test(answer) || /\?\s*$/.test(answer);
  const isOnlyQuestion = hasQuestionMark && answer.length < 260;

  // If evidence exists and the assistant produced a substantive answer, require at least one citation tag.
  if (!isOnlyQuestion && citations.length === 0) {
    verification.missing_citations = [
      ...new Set([...(verification.missing_citations || []), "No se detectaron citas, pero se proveyó evidencia (adjuntos/RAG)."])
    ];
    verification.issues = [
      ...(verification.issues || []),
      { issue: "Faltan citas trazables ([doc:...] / [img:...] / [mem:#]) para respaldar la respuesta.", severity: "high", evidence: [] }
    ];
    verification.is_coherent = false;
    verification.confidence = Math.min(verification.confidence ?? 0.5, 0.35);
  }

  // High-signal token traceability: if answer includes dates/numbers that do not appear in evidence, flag.
  const tokens = extractHighSignalTokens(answer);
  const lowerEvidence = evidence.toLowerCase();
  const missing: string[] = [];

  for (const tok of tokens) {
    const needle = tok.toLowerCase();
    if (!lowerEvidence.includes(needle)) missing.push(tok);
  }

  if (missing.length > 0) {
    verification.issues = [
      ...(verification.issues || []),
      {
        issue: "Se detectaron datos/fechas/numeros en la respuesta que no aparecen en la evidencia provista (posible alucinacion o falta de cita).",
        severity: "medium",
        evidence: missing.slice(0, 10),
      }
    ];
    verification.is_coherent = verification.is_coherent && citations.length > 0;
    verification.confidence = Math.min(verification.confidence ?? 0.5, citations.length > 0 ? 0.6 : 0.4);
  }

  return verification;
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

          return applyDeterministicChecks(verification, input);
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

    return applyDeterministicChecks(
      fallbackVerification(lastErr?.message || String(lastErr || "unknown")),
      input
    );
  }
}

export const verifierAgent = new VerifierAgent();
