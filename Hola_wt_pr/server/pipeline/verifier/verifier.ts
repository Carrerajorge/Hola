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

function extractBracketCitations(text: string): string[] {
  const matches = (text || "").match(/\[(?:doc|img|web):[^\]]+\]/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const c = m.trim();
    if (!c) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function removeInvalidCitations(text: string, allowed: Set<string>): string {
  return (text || "").replace(/\[(?:doc|img|web):[^\]]+\]/g, (m) => {
    const c = m.trim();
    return allowed.has(c) ? c : "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

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
  const citationsPossible = allowedCitations.length > 0;
  const allowedSet = new Set<string>(allowedCitations);

  const sourcesForPrompt = retrieved.slice(0, 12).map(r => ({
    citation: `[${r.chunk.sourceId}]`,
    sourceId: r.chunk.sourceId,
    filename: r.chunk.filename,
    location: r.chunk.location,
    headingPath: r.chunk.headingPath,
    excerpt: (r.chunk.rawContent || r.chunk.content).slice(0, 600),
    score: r.hybridScore,
  }));

  const basePrompt = [
    `Eres un Verifier/QA separado. Tu trabajo: validar coherencia y trazabilidad de una respuesta.`,
    ``,
    `Reglas:`,
    `- No inventes. Si falta informacion para cumplir el encargo, marca needs_clarification=true y escribe UNA pregunta aclaratoria.`,
    citationsPossible
      ? `- Si hay afirmaciones factuales (fechas, numeros, hechos concretos), deben tener citas validas.`
      : `- Si NO hay citas permitidas (lista vacía), NO exijas citas y NO marques missing_citation por ese motivo.`,
    `- Si el usuario EXIGE citas/fuentes pero no hay citas permitidas, entonces needs_clarification=true y pregunta si puede adjuntar fuentes o habilitar búsqueda web.`,
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
  ].join("\n");

  let attemptsTotal = 0;
  let lastRaw = "";
  let last: VerificationResult | null = null;
  let fixup: string = "";
  let currentDraft = draftAnswer;

  for (let round = 0; round < 2; round++) {
    const verifierPrompt = [
      basePrompt,
      fixup ? `\n\nFIX_REQUEST:\n${fixup}` : "",
      `DRAFT_ANSWER:\n${currentDraft}`,
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

    attemptsTotal += out.attempts;
    lastRaw = out.raw;
    last = out.value;

    if (!citationsPossible || last.needs_clarification) {
      return { result: last, raw: lastRaw, attempts: attemptsTotal };
    }

    const found = extractBracketCitations(last.final_answer);
    const invalid = found.filter(c => !allowedSet.has(c));
    const missingAny = found.length === 0;

    if (invalid.length === 0 && !missingAny) {
      return { result: last, raw: lastRaw, attempts: attemptsTotal };
    }

    // Prepare a stricter repair round.
    const invalidList = invalid.length > 0 ? invalid.slice(0, 8).join(", ") : "";
    fixup = [
      `Tu salida anterior NO cumple.`,
      invalid.length > 0 ? `- Hay citas INVALIDAS: ${invalidList}` : `- Faltan citas en la respuesta final.`,
      `Reescribe final_answer para:`,
      `- Usar SOLO citas permitidas (exact match).`,
      `- Incluir al menos 1 cita si afirmas hechos (y en este pipeline debes incluir al menos una cita en la respuesta final).`,
      `- Si no puedes sustentar la respuesta con las fuentes recuperadas, marca needs_clarification=true con UNA sola pregunta y detente.`,
    ].join("\n");

    const sanitized = removeInvalidCitations(last.final_answer, allowedSet);
    currentDraft = sanitized || currentDraft;
  }

  // If we could not repair citations, fail closed: strip invalid citations and ask clarification if no valid ones remain.
  if (!last) {
    const fallback: VerificationResult = {
      verdict: "fail",
      confidence: 0.2,
      needs_clarification: true,
      clarification_question: "¿Podés adjuntar las fuentes o indicar qué documento/imagen exactos debo citar para responder?",
      issues: [{ type: "other", severity: "high", detail: "Verifier failed with no output" }],
      citations_used: [],
      missing_citations: [],
      final_answer: "Necesito una aclaración para continuar.",
    };
    return { result: fallback, raw: lastRaw, attempts: attemptsTotal };
  }

  const sanitizedAnswer = removeInvalidCitations(last.final_answer, allowedSet);
  const remaining = extractBracketCitations(sanitizedAnswer);
  const issues = Array.isArray(last.issues) ? last.issues.slice() : [];

  if (sanitizedAnswer !== last.final_answer) {
    issues.push({
      type: "citation_invalid",
      severity: "high",
      detail: "Se detectaron y removieron citas invalidas (no pertenecian a la lista permitida).",
    });
  }

  const needsClarification = citationsPossible && !last.needs_clarification && remaining.length === 0;
  const result: VerificationResult = {
    ...last,
    verdict: needsClarification ? "fail" : last.verdict,
    needs_clarification: needsClarification ? true : last.needs_clarification,
    clarification_question: needsClarification
      ? "¿Querés que rehaga la respuesta asegurando citas estrictas solo de las fuentes recuperadas?"
      : last.clarification_question,
    issues,
    citations_used: remaining,
    missing_citations: needsClarification ? ["(no valid citations in final_answer)"] : last.missing_citations,
    final_answer: sanitizedAnswer || last.final_answer,
  };

  return { result, raw: lastRaw, attempts: attemptsTotal };
}
