import { z } from "zod";

import { generateStructuredOutput } from "../../lib/structuredOutput";
import type { CanonicalBrief } from "../requestUnderstanding/briefSchema";
import type { RetrievalCandidate } from "./hybridRetrieval";

const RerankResultSchema = z.object({
  selected_ids: z.array(z.string().min(1)).min(1),
  notes: z.string().optional(),
});

type RerankResult = z.infer<typeof RerankResultSchema>;

function uniqStable<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

export async function rerankCandidatesWithLlm(args: {
  query: string;
  brief: CanonicalBrief;
  candidates: RetrievalCandidate[];
  topK: number;
  model?: string;
  userId?: string;
  requestId?: string;
}): Promise<{ selected: RetrievalCandidate[]; raw: string; attempts: number; notes?: string }> {
  const {
    query,
    brief,
    candidates,
    topK,
    model = process.env.ENCARGO_RERANK_MODEL || "gemini-2.5-flash",
    userId,
    requestId,
  } = args;

  const trimmed = candidates.slice(0, Math.min(24, candidates.length));
  const idSet = new Set(trimmed.map(c => c.chunk.id));

  const briefSummary = {
    primary_intent: brief.primary_intent,
    subtasks: brief.subtasks,
    deliverable: brief.deliverable,
    audience_tone: brief.audience_tone,
    restrictions: brief.restrictions,
    success_criteria: brief.success_criteria?.slice?.(0, 8) || [],
  };

  const items = trimmed.map((c, idx) => ({
    id: c.chunk.id,
    idx,
    sourceId: c.chunk.sourceId,
    kind: c.chunk.kind,
    kindLabel: String(c.chunk.metadata?.kindLabel || ""),
    location: c.chunk.location,
    headingPath: c.chunk.headingPath,
    score: Number(c.hybridScore.toFixed(4)),
    excerpt: (c.chunk.rawContent || c.chunk.content || "").slice(0, 900),
  }));

  const prompt = [
    `Eres un reranker. Debes ordenar y seleccionar los chunks mas relevantes para responder al encargo.`,
    ``,
    `Reglas:`,
    `- Elige los mejores chunks para contestar la consulta del usuario siguiendo el BRIEF_CANONICO.`,
    `- Cobertura: si hay varias subtareas, prioriza cubrirlas todas con evidencia.`,
    `- No inventes IDs: solo puedes devolver IDs presentes en CANDIDATES.`,
    `- Devuelve EXACTAMENTE ${topK} IDs si hay suficientes candidatos; si no, devuelve todos.`,
    ``,
    `QUERY:\n${query}`,
    ``,
    `BRIEF_CANONICO (resumen):\n${JSON.stringify(briefSummary)}`,
    ``,
    `CANDIDATES (JSON):\n${JSON.stringify(items)}`,
    ``,
    `Devuelve JSON con: selected_ids (lista ordenada), notes (opcional).`,
  ].join("\n");

  const out = await generateStructuredOutput({
    messages: [{ role: "user", content: prompt }],
    schema: RerankResultSchema,
    schemaName: "EncargoRerankResult",
    model,
    provider: "auto",
    temperature: 0.1,
    maxTokens: 800,
    userId,
    requestId,
    maxRetries: 1,
    timeoutMs: 25000,
  });

  const value: RerankResult = out.value;
  const ordered = uniqStable(value.selected_ids)
    .filter(id => idSet.has(id));

  const fallback = trimmed.map(c => c.chunk.id);
  const finalIds = uniqStable([...ordered, ...fallback]).slice(0, Math.min(topK, trimmed.length));

  const byId = new Map(trimmed.map(c => [c.chunk.id, c] as const));
  const selected = finalIds.map(id => byId.get(id)).filter(Boolean) as RetrievalCandidate[];

  return { selected, raw: out.raw, attempts: out.attempts, notes: value.notes };
}

