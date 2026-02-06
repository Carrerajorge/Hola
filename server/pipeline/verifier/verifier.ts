import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { generateStructuredOutput } from "../../lib/structuredOutput";
import type { CanonicalBrief } from "../requestUnderstanding/briefSchema";
import type { RetrievalCandidate } from "../retrieval/hybridRetrieval";

const VerificationIssueSchema = z.object({
  type: z.enum([
    "missing_citation",
    "citation_invalid",
    "contradiction",
    "date_inconsistency",
    "number_inconsistency",
    "hallucination_risk",
    "format_violation",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  detail: z.string().min(1),
});

export const VerificationResultSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  confidence: z.number().min(0).max(1),
  needs_clarification: z.boolean(),
  clarification_question: z.string().min(1).nullable(),
  issues: z.array(VerificationIssueSchema).default([]),
  citations_used: z.array(z.string().min(1)).default([]),
  missing_citations: z.array(z.string().min(1)).default([]),
  final_answer: z.string().min(1),
}).superRefine((val, ctx) => {
  if (val.needs_clarification && !val.clarification_question) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clarification_question"],
      message: "clarification_question must be provided when needs_clarification=true",
    });
  }
  if (!val.needs_clarification && val.clarification_question !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clarification_question"],
      message: "clarification_question must be null when needs_clarification=false",
    });
  }
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export async function verifyAnswer(args: {
  userMessage: string;
  brief: CanonicalBrief;
  draftAnswer: string;
  retrieved: RetrievalCandidate[];
  requestId?: string;
  userId?: string;
  model?: string;
}): Promise<{ result: VerificationResult; raw: string; attempts: number }> {
  const {
    userMessage,
    brief,
    draftAnswer,
    retrieved,
    requestId,
    userId,
    model = "gemini-2.5-pro",
  } = args;

  // Must match the answer generator's citation format: bracketed tags like "[doc:... p3 sec:\"...\"]".
  const allowedCitations = retrieved.map(r => `[${r.chunk.sourceId}]`);

  const sourcesForPrompt = retrieved.slice(0, 12).map(r => ({
    citation: `[${r.chunk.sourceId}]`,
    sourceId: r.chunk.sourceId,
    filename: r.chunk.filename,
    location: r.chunk.location,
    headingPath: r.chunk.headingPath,
    excerpt: (r.chunk.rawContent || r.chunk.content).slice(0, 600),
    score: r.hybridScore,
  }));

  const verifierPrompt = [
    `Eres un Verifier/QA separado. Tu trabajo: validar coherencia y trazabilidad de una respuesta.`,
    ``,
    `Reglas:`,
    `- No inventes. Si falta informacion para cumplir el encargo, marca needs_clarification=true y escribe UNA pregunta aclaratoria.`,
    `- Si hay afirmaciones factuales (fechas, numeros, hechos concretos), deben tener citas.`,
    `- Las citas permitidas deben ser exactamente una de estas cadenas:`,
    JSON.stringify(allowedCitations),
    `- Si una cita no coincide con la lista, es citation_invalid.`,
    `- Señala contradicciones entre fuentes y respuesta.`,
    `- Puedes reescribir la respuesta para corregir formato/citas, pero no agregues hechos sin fuente.`,
    ``,
    `USER_MESSAGE:\n${userMessage}`,
    ``,
    `CANONICAL_BRIEF (resumen):\n${JSON.stringify({
      primary_intent: brief.primary_intent,
      subtasks: brief.subtasks,
      deliverable: brief.deliverable,
      audience_tone: brief.audience_tone,
      restrictions: brief.restrictions,
    })}`,
    ``,
    `RETRIEVED_SOURCES (excerpts):\n${JSON.stringify(sourcesForPrompt)}`,
    ``,
    `DRAFT_ANSWER:\n${draftAnswer}`,
    ``,
    `Devuelve JSON con: verdict, confidence, needs_clarification, clarification_question, issues, citations_used, missing_citations, final_answer.`,
  ].join("\n");

  const messages: ChatCompletionMessageParam[] = [{ role: "user", content: verifierPrompt }];

  const out = await generateStructuredOutput({
    messages,
    schema: VerificationResultSchema,
    schemaName: "VerificationResult",
    model,
    provider: "auto",
    temperature: 0.1,
    maxTokens: 2200,
    userId,
    requestId,
    maxRetries: 2,
    timeoutMs: 45000,
  });

  return { result: out.value, raw: out.raw, attempts: out.attempts };
}
