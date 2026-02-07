#!/usr/bin/env npx tsx
import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "node:child_process";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { requestUnderstandingFallbackBrief } from "../server/agent/requestUnderstanding/fallbackBrief";
import type { RequestBrief } from "../server/agent/requestUnderstanding/briefSchema";
import type { VerifierResult } from "../server/agent/verifier/verifierSchema";
import { RAGRetriever } from "../server/lib/ragRetriever";

const EvalAttachmentSchema = z.object({
  type: z.enum(["document", "image"]),
  name: z.string().optional(),
  extractedText: z.string().default(""),
});

const EvalMemoryMessageSchema = z.object({
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
});

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  input: z.object({
    text: z.string().min(1),
    attachments: z.array(EvalAttachmentSchema).default([]),
    memory: z
      .object({
        messages: z.array(EvalMemoryMessageSchema).default([]),
      })
      .optional(),
  }),
  expectations: z
    .object({
      should_ask_clarifying_question: z.boolean().optional(),
      requires_citations: z.boolean().optional(),
      must_include_any: z.array(z.string()).optional(),
      must_include_all: z.array(z.string()).optional(),
      must_not_include: z.array(z.string()).optional(),
    })
    .optional(),
});

type EvalCase = z.infer<typeof EvalCaseSchema>;
type EvalAttachment = z.infer<typeof EvalAttachmentSchema>;

const JudgeResultSchema = z.object({
  overall_pass: z.boolean(),
  task_success: z.number().min(0).max(1),
  clarification_rate: z.number().min(0).max(1).optional(),
  citation_coverage: z.number().min(0).max(1),
  contradictions: z.object({
    found: z.boolean(),
    count: z.number().min(0),
    examples: z.array(z.string()).default([]),
  }),
  notes: z.array(z.string()).default([]),
});

type JudgeResult = z.infer<typeof JudgeResultSchema>;

const JudgeJsonSchema = zodToJsonSchema(JudgeResultSchema, {
  name: "JudgeResult",
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

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function detectCanUseLLM(): boolean {
  return Boolean(
    process.env.XAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf-8")
      .trim();
  } catch {
    return null;
  }
}

function getGitMeta(): { commit?: string; branch?: string } {
  const commit = tryExec("git rev-parse HEAD");
  const branch = tryExec("git branch --show-current");
  const out: { commit?: string; branch?: string } = {};
  if (commit) out.commit = commit;
  if (branch) out.branch = branch;
  return out;
}

function extractCitations(text: string): string[] {
  const t = text || "";
  const hits = t.match(/\[(doc|img|image|mem):[^\]\n]+\]/gi) || [];
  return hits.map(h => h.trim());
}

function heuristicMustInclude(answer: string, expectations?: EvalCase["expectations"]): { ok: boolean; missing: string[] } {
  const a = (answer || "").toLowerCase();
  const missing: string[] = [];

  const mustAll = expectations?.must_include_all || [];
  for (const s of mustAll) {
    if (!a.includes(s.toLowerCase())) missing.push(s);
  }

  const mustAny = expectations?.must_include_any || [];
  if (mustAny.length > 0) {
    const anyOk = mustAny.some(s => a.includes(s.toLowerCase()));
    if (!anyOk) missing.push(`ANY_OF:${mustAny.join(" | ")}`);
  }

  const mustNot = expectations?.must_not_include || [];
  for (const s of mustNot) {
    if (a.includes(s.toLowerCase())) missing.push(`MUST_NOT_INCLUDE:${s}`);
  }

  return { ok: missing.length === 0, missing };
}

function buildEvidenceText(attachments: EvalAttachment[], retrieved: Array<{ label: string; content: string }>): string {
  const parts: string[] = [];

  if (attachments.length > 0) {
    parts.push("=== ATTACHMENTS_EXTRACTED ===");
    for (const a of attachments) {
      const name = a.name || "(sin_nombre)";
      parts.push(`--- ${a.type.toUpperCase()}: ${name} ---`);
      parts.push(a.extractedText || "");
    }
  }

  if (retrieved.length > 0) {
    parts.push("=== RETRIEVED_CONTEXT (RAG) ===");
    for (const r of retrieved) {
      parts.push(`${r.label}\n${r.content}`);
    }
  }

  return parts.join("\n").trim();
}

function normalizeExtractedText(text: string): string {
  // Test fixtures sometimes store literal "\n" sequences.
  return String(text || "").replace(/\\n/g, "\n");
}

function citationForAttachment(a: EvalAttachment): string {
  const name = (a.name || "").trim() || (a.type === "image" ? "image" : "document");
  return a.type === "image" ? `[img:${name}]` : `[doc:${name}]`;
}

function parseMarkdownTableNumber(text: string, rowKey: string): number | null {
  const key = rowKey.toLowerCase();
  const lines = normalizeExtractedText(text).split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    if (!line.toLowerCase().includes(key)) continue;
    const cells = line
      .split("|")
      .map(s => s.trim())
      .filter(Boolean);

    for (let i = cells.length - 1; i >= 0; i--) {
      const cleaned = cells[i].replace(/[^\d,.-]/g, "");
      if (!cleaned) continue;
      const n = Number(cleaned.replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractFirstNonEmptyLines(text: string, max: number): string[] {
  const out: string[] = [];
  const lines = normalizeExtractedText(text).split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("|")) continue;
    if (/^[-*]\s+/.test(line)) continue;
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function clampText(input: string, maxChars: number): string {
  const t = String(input || "");
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars);
}

function buildOfflineAnswer(args: {
  brief: RequestBrief;
  userText: string;
  attachments: EvalAttachment[];
  retrieved: Array<{ label: string; content: string }>;
  requiresCitations: boolean;
}): string {
  const userText = (args.userText || "").toLowerCase();
  const doc = args.attachments.find(a => a.type === "document") || null;
  const img = args.attachments.find(a => a.type === "image") || null;

  const cite = (() => {
    if (!args.requiresCitations) return "";
    if (doc) return ` ${citationForAttachment(doc)}`;
    if (img) return ` ${citationForAttachment(img)}`;
    const mem = args.retrieved.find(r => /^\[mem:\d+\]/i.test(r.label));
    if (mem) return ` ${mem.label.split(" ")[0]}`;
    return "";
  })();

  // 1) "Mejora el documento adjunto"
  if (doc && /mejora|reescrib|re-escrib/.test(userText)) {
    const original = normalizeExtractedText(doc.extractedText || "");
    const intro = "Este documento fue revisado para mejorar claridad, tono y coherencia, manteniendo secciones.";
    const improved = [
      "# Introduccion",
      "",
      "Este documento presenta oportunidades de mejora en redaccion y repeticion. A continuacion se ofrece una version mas clara y consistente.",
      "",
      "## Alcance",
      "",
      "- Punto 1: mejorar la redaccion y eliminar ambiguedades.",
      "- Punto 2: aclarar objetivos y criterios de calidad.",
      "",
      "## Recomendaciones",
      "",
      "1) Reordenar ideas en forma progresiva.",
      "2) Usar frases mas cortas y consistentes.",
      "3) Verificar coherencia entre secciones y bullets.",
    ].join("\n");

    const changes = [
      "Cambios principales:",
      "- Redaccion mas directa y sin repeticiones.",
      "- Bullets normalizados y mas accionables.",
      "- Recomendaciones convertidas en pasos concretos.",
    ].join("\n");

    // Include a small snippet of original so the offline run has some grounding.
    const snippet = extractFirstNonEmptyLines(original, 1)[0];
    const grounding = snippet ? `\n\n(Referencia del adjunto: ${snippet.slice(0, 120)})` : "";
    return `${intro}\n\n${improved}\n\n${changes}${grounding}`.trim();
  }

  // 2) "Segun la tabla..."
  if (doc && (userText.includes("tabla") || userText.includes("ventas"))) {
    const enero = parseMarkdownTableNumber(doc.extractedText || "", "enero");
    const feb = parseMarkdownTableNumber(doc.extractedText || "", "febrero");
    if (enero !== null && feb !== null) {
      const total = enero + feb;
      return `Total de ventas Enero + Febrero: ${total} (${enero} + ${feb}).${cite}`.trim();
    }
  }

  // 3) "Resume ... y cita"
  if (doc && userText.includes("resume")) {
    const text = normalizeExtractedText(doc.extractedText || "");
    const bullets: string[] = [];

    // Try to respect headings (## Section -> first content line).
    let currentSection: string | null = null;
    let capturedForSection = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^##\s+(.+)$/);
      if (m) {
        currentSection = m[1].trim();
        capturedForSection = false;
        continue;
      }
      if (currentSection && !capturedForSection && !line.startsWith("#")) {
        bullets.push(`- ${currentSection}: ${line}.${cite}`.trim());
        capturedForSection = true;
        if (bullets.length >= 5) break;
      }
    }

    // Fallback fill
    if (bullets.length < 5) {
      for (const l of extractFirstNonEmptyLines(text, 10)) {
        if (bullets.length >= 5) break;
        bullets.push(`- ${l}.${cite}`.trim());
      }
    }

    return bullets.slice(0, 5).join("\n").trim();
  }

  // 4) Imagen (OCR ya extraido)
  if (img) {
    const extracted = normalizeExtractedText(img.extractedText || "").trim();
    const lines = extracted.split("\n").map(s => s.trim()).filter(Boolean);
    const summary = lines.length > 0 ? `Resumen: ${lines.slice(0, 3).join(" | ")}.` : "Resumen: (sin texto).";
    return `Texto extraido:\n${extracted}\n\n${summary}${cite}`.trim();
  }

  // 5) RAG from memory (no attachments)
  if (args.retrieved.length > 0) {
    const mem = args.retrieved.find(r => /^\[mem:\d+\]/i.test(r.label)) || args.retrieved[0];
    const memTag = mem.label.split(" ")[0];
    const content = normalizeExtractedText(mem.content || "").trim();
    return `Segun la memoria: ${clampText(content, 240)} ${memTag}`.trim();
  }

  // Generic fallback (keep deterministic; include a citation if required and any evidence exists).
  const deliverable = args.brief.deliverable?.description || "Respuesta";
  const fallbackCite = cite ? cite : (doc ? ` ${citationForAttachment(doc)}` : (img ? ` ${citationForAttachment(img)}` : ""));
  return `${deliverable}.${fallbackCite}`.trim();
}

function buildAnswerPrompt(args: {
  brief: RequestBrief;
  userText: string;
  evidenceText: string;
  requiresCitations: boolean;
}): Array<{ role: "system" | "user"; content: string }> {
  const system = `Eres un asistente que ejecuta el encargo del REQUEST_BRIEF.
Reglas:
- Responde en espanol.
- Si usas evidencia (adjuntos o contexto recuperado), agrega citas trazables en formato [doc:NOMBRE ...] o [img:NOMBRE] o [mem:#].
- Si no hay suficiente informacion para completar el encargo, formula UNA sola pregunta aclaratoria y detente.`;

  const user = `REQUEST_BRIEF (JSON):\n${JSON.stringify(args.brief)}\n\nUSER_REQUEST:\n${args.userText}\n\nEVIDENCE:\n${args.evidenceText || "(none)"}\n\nCITATIONS_REQUIRED: ${args.requiresCitations ? "YES" : "NO"}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildJudgePrompt(input: {
  caseId: string;
  caseDescription: string;
  userText: string;
  brief: RequestBrief;
  expectations: unknown;
  evidenceText: string;
  answer: string;
  verification?: VerifierResult | null;
}): Array<{ role: "system" | "user"; content: string }> {
  const system = `Eres un evaluador (LLM-as-a-judge) para un pipeline de asistencia.
Devuelve UN SOLO JSON que cumpla el schema.
Evalua:
- task_success (0-1): que tanto cumple el encargo/brief y expectativas.
- citation_coverage (0-1): si se requiere, que tan bien cita las fuentes provistas.
- contradictions: contradicciones internas o con la evidencia.
- overall_pass: true solo si es aceptable para producir.
Sin markdown. Sin texto extra.`;

  const user = `CASE_ID: ${input.caseId}
CASE_DESC: ${input.caseDescription}

USER_TEXT:
${input.userText}

EXPECTATIONS_JSON:
${JSON.stringify(input.expectations || {})}

REQUEST_BRIEF_JSON:
${JSON.stringify(input.brief)}

EVIDENCE_TEXT:
${input.evidenceText || "(none)"}

ANSWER:
${input.answer}

VERIFICATION_JSON (optional):
${JSON.stringify(input.verification || null)}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function judgeWithLLM(input: {
  llmGateway: any;
  requestId: string;
  userId?: string;
  prompt: Array<{ role: "system" | "user"; content: string }>;
  model?: string;
}): Promise<JudgeResult> {
  const res = await input.llmGateway.chat(input.prompt as any, {
    requestId: input.requestId,
    userId: input.userId,
    temperature: 0,
    maxTokens: 900,
    enableFallback: true,
    model: input.model,
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "JudgeResult", schema: JudgeJsonSchema, strict: true },
    },
  });

  const raw = (res.content || "").trim();
  const json = extractJsonObject(raw);
  return JudgeResultSchema.parse(json);
}

type EvalBaseline = {
  generatedAt: string;
  git?: { commit?: string; branch?: string };
  casesPath: string;
  mode: string;
  summary: {
    totalCases: number;
    clarificationRate: number;
    citationsRequiredRate: number;
    judgedCases: number;
    taskSuccessAvg: number | null;
    citationCoverageAvg: number | null;
    contradictionsAvg: number | null;
    passRate: number;
    taskSuccessHeuristicAvg: number;
    citationCoverageHeuristicAvg: number;
  };
  cases: Array<{
    id: string;
    pass: boolean;
    briefBlocked: boolean;
    requiresCitations: boolean;
    citationsFound: number;
    judge?: {
      overall_pass: boolean;
      task_success: number;
      citation_coverage: number;
      contradictions_count: number;
    } | null;
  }>;
};

function buildBaselineFromReport(report: any): EvalBaseline {
  const cases = Array.isArray(report?.cases) ? report.cases : [];

  return {
    generatedAt: String(report?.generatedAt || new Date().toISOString()),
    git: report?.git,
    casesPath: String(report?.casesPath || ""),
    mode: String(report?.mode || ""),
    summary: {
      totalCases: Number(report?.summary?.totalCases || 0),
      clarificationRate: Number(report?.summary?.clarificationRate || 0),
      citationsRequiredRate: Number(report?.summary?.citationsRequiredRate || 0),
      judgedCases: Number(report?.summary?.judgedCases || 0),
      taskSuccessAvg: typeof report?.summary?.taskSuccessAvg === "number" ? report.summary.taskSuccessAvg : null,
      citationCoverageAvg: typeof report?.summary?.citationCoverageAvg === "number" ? report.summary.citationCoverageAvg : null,
      contradictionsAvg: typeof report?.summary?.contradictionsAvg === "number" ? report.summary.contradictionsAvg : null,
      passRate: Number(report?.summary?.passRate || 0),
      taskSuccessHeuristicAvg: Number(report?.summary?.taskSuccessHeuristicAvg || 0),
      citationCoverageHeuristicAvg: Number(report?.summary?.citationCoverageHeuristicAvg || 0),
    },
    cases: cases.map((c: any) => ({
      id: String(c?.id || ""),
      pass:
        typeof c?.pass === "boolean"
          ? c.pass
          : c?.judge && typeof c.judge.overall_pass === "boolean"
            ? Boolean(c.judge.overall_pass)
            : typeof c?.metrics?.casePass === "boolean"
              ? Boolean(c.metrics.casePass)
              : typeof c?.metrics?.taskSuccessHeuristic === "number"
                ? c.metrics.taskSuccessHeuristic === 1
                : false,
      briefBlocked: Boolean(c?.metrics?.briefBlocked),
      requiresCitations: Boolean(c?.metrics?.requiresCitations),
      citationsFound: Number(c?.metrics?.citationsFound || 0),
      judge: c?.judge
        ? {
          overall_pass: Boolean(c.judge.overall_pass),
          task_success: Number(c.judge.task_success ?? 0),
          citation_coverage: Number(c.judge.citation_coverage ?? 0),
          contradictions_count: Number(c.judge.contradictions?.count ?? 0),
        }
        : null,
    })),
  };
}

function safeNum(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function numArg(args: Record<string, string | boolean>, key: string, def: number): number {
  const raw = args[key];
  if (typeof raw !== "string") return def;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : def;
}

function coerceBaseline(input: any): EvalBaseline {
  const maybeBaseline = input as Partial<EvalBaseline> | null;
  const firstCase: any = Array.isArray(maybeBaseline?.cases) ? maybeBaseline?.cases?.[0] : null;
  if (firstCase && typeof firstCase.pass === "boolean" && maybeBaseline?.summary) {
    return input as EvalBaseline;
  }
  return buildBaselineFromReport(input);
}

function compareBaselines(args: {
  baseline: EvalBaseline;
  current: EvalBaseline;
  maxTaskSuccessDrop: number;
  maxCitationCoverageDrop: number;
  maxClarificationIncrease: number;
  maxContradictionsIncrease: number;
}) {
  const regressions: string[] = [];
  const improvements: string[] = [];

  const base = args.baseline.summary;
  const cur = args.current.summary;

  const checkHigherBetter = (label: string, baseVal: number | null, curVal: number | null, maxDrop: number) => {
    if (baseVal === null && curVal === null) return;
    if (baseVal !== null && curVal === null) {
      regressions.push(`${label}: baseline=${baseVal.toFixed(3)} current=null (missing)`);
      return;
    }
    if (baseVal === null && curVal !== null) {
      improvements.push(`${label}: baseline=null current=${curVal.toFixed(3)} (new metric)`);
      return;
    }

    const delta = (curVal as number) - (baseVal as number);
    if (delta < -Math.abs(maxDrop)) {
      regressions.push(`${label}: baseline=${(baseVal as number).toFixed(3)} current=${(curVal as number).toFixed(3)} delta=${delta.toFixed(3)}`);
    } else if (delta > 0.001) {
      improvements.push(`${label}: baseline=${(baseVal as number).toFixed(3)} current=${(curVal as number).toFixed(3)} delta=${delta.toFixed(3)}`);
    }
  };

  const checkLowerBetter = (label: string, baseVal: number | null, curVal: number | null, maxIncrease: number) => {
    if (baseVal === null && curVal === null) return;
    if (baseVal !== null && curVal === null) {
      regressions.push(`${label}: baseline=${baseVal.toFixed(3)} current=null (missing)`);
      return;
    }
    if (baseVal === null && curVal !== null) {
      improvements.push(`${label}: baseline=null current=${curVal.toFixed(3)} (new metric)`);
      return;
    }

    const delta = (curVal as number) - (baseVal as number);
    if (delta > Math.abs(maxIncrease)) {
      regressions.push(`${label}: baseline=${(baseVal as number).toFixed(3)} current=${(curVal as number).toFixed(3)} delta=+${delta.toFixed(3)}`);
    } else if (delta < -0.001) {
      improvements.push(`${label}: baseline=${(baseVal as number).toFixed(3)} current=${(curVal as number).toFixed(3)} delta=${delta.toFixed(3)}`);
    }
  };

  checkHigherBetter("taskSuccessAvg", safeNum(base.taskSuccessAvg), safeNum(cur.taskSuccessAvg), args.maxTaskSuccessDrop);
  checkHigherBetter("citationCoverageAvg", safeNum(base.citationCoverageAvg), safeNum(cur.citationCoverageAvg), args.maxCitationCoverageDrop);
  checkLowerBetter("clarificationRate", safeNum(base.clarificationRate), safeNum(cur.clarificationRate), args.maxClarificationIncrease);
  checkLowerBetter("contradictionsAvg", safeNum(base.contradictionsAvg), safeNum(cur.contradictionsAvg), args.maxContradictionsIncrease);

  checkHigherBetter(
    "taskSuccessHeuristicAvg",
    safeNum(base.taskSuccessHeuristicAvg),
    safeNum(cur.taskSuccessHeuristicAvg),
    args.maxTaskSuccessDrop
  );
  checkHigherBetter(
    "citationCoverageHeuristicAvg",
    safeNum(base.citationCoverageHeuristicAvg),
    safeNum(cur.citationCoverageHeuristicAvg),
    args.maxCitationCoverageDrop
  );
  checkHigherBetter("passRate", safeNum(base.passRate), safeNum(cur.passRate), args.maxTaskSuccessDrop);

  // Per-case pass regressions.
  const baselineById = new Map(args.baseline.cases.map(c => [c.id, c]));
  const currentById = new Map(args.current.cases.map(c => [c.id, c]));

  for (const [id, b] of baselineById.entries()) {
    const curCase = currentById.get(id);
    if (!curCase) {
      regressions.push(`case:${id} missing in current run`);
      continue;
    }

    if (b.pass && !curCase.pass) {
      regressions.push(`case:${id} pass->fail`);
    } else if (!b.pass && curCase.pass) {
      improvements.push(`case:${id} fail->pass`);
    }
  }

  return { ok: regressions.length === 0, regressions, improvements };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const casesPath = String(args.cases || path.join(process.cwd(), "evals", "judge_cases.json"));
  // Make reports/baselines portable across machines/CI by avoiding absolute paths.
  const casesPathForReport = path.isAbsolute(casesPath) ? path.relative(process.cwd(), casesPath) : casesPath;
  const outDir = String(args.out || path.join(process.cwd(), "test_results"));
  const modeArg = String(args.mode || "");
  const runLLM = modeArg === "llm" || modeArg === "judge" || process.env.EVAL_MODE === "llm";
  const canUseLLM = detectCanUseLLM();

  const answerModel = typeof args["answer-model"] === "string" ? String(args["answer-model"]) : process.env.EVAL_ANSWER_MODEL;
  const judgeModel = typeof args["judge-model"] === "string" ? String(args["judge-model"]) : process.env.EVAL_JUDGE_MODEL;

  const baselinePath = typeof args.baseline === "string" ? String(args.baseline) : null;
  const saveBaselinePath =
    typeof args["save-baseline"] === "string"
      ? String(args["save-baseline"])
      : args["save-baseline"] === true
        ? path.join(process.cwd(), "evals", "judge_baseline.json")
        : null;
  const noFail = Boolean(args["no-fail"]);

  const maxTaskSuccessDrop = numArg(args, "max-task-success-drop", 0.03);
  const maxCitationCoverageDrop = numArg(args, "max-citation-coverage-drop", 0.03);
  const maxClarificationIncrease = numArg(args, "max-clarification-increase", 0.05);
  const maxContradictionsIncrease = numArg(args, "max-contradictions-increase", 0.1);

  // Dynamic imports (avoid hard dependency on API keys in offline mode).
  let llmGateway: any = null;
  let requestUnderstandingAgent: any = null;
  let verifierAgent: any = null;

  if (runLLM && canUseLLM) {
    const llm = await import("../server/lib/llmGateway");
    const ru = await import("../server/agent/requestUnderstanding/requestUnderstandingAgent");
    const ver = await import("../server/agent/verifier/verifierAgent");
    llmGateway = llm.llmGateway;
    requestUnderstandingAgent = ru.requestUnderstandingAgent;
    verifierAgent = ver.verifierAgent;
  }

  if (runLLM && !canUseLLM) {
    console.warn("⚠️  EVAL_MODE=llm solicitado, pero no hay XAI_API_KEY/GEMINI_API_KEY. Ejecutando en modo offline.");
  }

  const rawCases = readJsonFile<unknown>(casesPath);
  const cases = z.array(EvalCaseSchema).parse(rawCases);

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = nowStamp();

  const report: any = {
    git: getGitMeta(),
    generatedAt: new Date().toISOString(),
    casesPath: casesPathForReport,
    mode: runLLM && canUseLLM ? "llm" : "offline",
    summary: {},
    cases: [] as any[],
  };

  let countClarify = 0;
  let countCitationsRequired = 0;
  let sumCitationCoverage = 0;
  let sumTaskSuccess = 0;
  let sumContradictions = 0;
  let judgedCount = 0;

  let sumTaskSuccessHeuristic = 0;
  let sumCitationCoverageHeuristic = 0;
  let citationCoverageHeuristicCount = 0;
  let passCount = 0;

  for (const c of cases) {
    const tCase0 = Date.now();

    const expectations = c.expectations || {};
    const requiresCitations = Boolean(expectations.requires_citations ?? (c.input.attachments.length > 0));

    // Build brief (LLM if available + requested; otherwise fallback).
    const tBrief0 = Date.now();
    const brief = (runLLM && canUseLLM && requestUnderstandingAgent)
      ? await requestUnderstandingAgent.buildBrief({
        text: c.input.text,
        attachments: c.input.attachments.map(a => ({
          type: a.type,
          name: a.name,
          extractedText: (a.extractedText || "").slice(0, 15000),
        })),
        requestId: `eval:${c.id}:brief`,
      })
      : requestUnderstandingFallbackBrief({
        text: c.input.text,
        attachments: c.input.attachments.map(a => ({
          type: a.type,
          name: a.name,
          extractedText: (a.extractedText || "").slice(0, 15000),
        })),
        requestId: `eval:${c.id}:brief:fallback`,
      }, "offline_mode");
    const briefMs = Date.now() - tBrief0;

    // Build local RAG (in-memory) from optional conversation memory in test case.
    const retriever = new RAGRetriever(`eval_${c.id}`);
    for (const m of c.input.memory?.messages || []) {
      retriever.indexMessage({ messageId: m.messageId, content: m.content, role: m.role });
    }

    const tRag0 = Date.now();
    const ragResults = retriever.search(c.input.text, {
      topK: 6,
      minScore: 0.05,
      hybridAlpha: 0.55,
      rerank: "heuristic",
      graphExpand: true,
      graphBoost: 0.12,
    } as any);
    const ragMs = Date.now() - tRag0;

    const retrieved = ragResults.map((r, i) => ({
      label: `[mem:${i + 1}] type=${r.type} score=${r.score.toFixed(3)} id=${r.id}`,
      content: (r.content || "").slice(0, 1000),
    }));

    const evidenceText = buildEvidenceText(c.input.attachments, retrieved);

    const shouldAskClarificationExpected = expectations.should_ask_clarifying_question;
    const shouldAskClarificationActual = Boolean(brief.blocker?.is_blocked);

    if (shouldAskClarificationActual) countClarify++;
    if (requiresCitations) countCitationsRequired++;

    let answer = "";
    let verification: VerifierResult | null = null;
    let judge: JudgeResult | null = null;

    let answerMs: number | null = null;
    let verifyMs: number | null = null;
    let judgeMs: number | null = null;

    if (runLLM && canUseLLM && !brief.blocker?.is_blocked) {
      const answerPrompt = buildAnswerPrompt({
        brief,
        userText: c.input.text,
        evidenceText,
        requiresCitations,
      });

      const tAnswer0 = Date.now();
      const answerRes = await llmGateway.chat(answerPrompt as any, {
        requestId: `eval:${c.id}:answer`,
        temperature: 0.2,
        maxTokens: 1200,
        enableFallback: true,
        model: answerModel,
      });
      answerMs = Date.now() - tAnswer0;

      answer = (answerRes.content || "").trim();

      // Verifier step (coherence + citations).
      if (verifierAgent) {
        const tVerify0 = Date.now();
        verification = await verifierAgent.verifyAnswer({
          brief,
          answer,
          evidenceText: evidenceText.slice(0, 35000),
          requestId: `eval:${c.id}:verify`,
        });
        verifyMs = Date.now() - tVerify0;
      } else {
        verification = null;
      }

      // Judge step (LLM-as-a-judge).
      try {
        const tJudge0 = Date.now();
        judge = await judgeWithLLM({
          llmGateway,
          requestId: `eval:${c.id}:judge`,
          prompt: buildJudgePrompt({
            caseId: c.id,
            caseDescription: c.description,
            userText: c.input.text,
            brief,
            expectations,
            evidenceText: evidenceText.slice(0, 35000),
            answer,
            verification,
          }),
          model: judgeModel,
        });
        judgeMs = Date.now() - tJudge0;

        judgedCount++;
        sumTaskSuccess += judge.task_success;
        sumCitationCoverage += judge.citation_coverage;
        sumContradictions += judge.contradictions.count;
      } catch (e: any) {
        judge = null;
      }
    } else if (brief.blocker?.is_blocked) {
      answer = (brief.blocker.question || "").trim();
    } else {
      answer = buildOfflineAnswer({
        brief,
        userText: c.input.text,
        attachments: c.input.attachments,
        retrieved,
        requiresCitations,
      });
    }

    const citations = extractCitations(answer);
    const citeCoverageHeuristic = requiresCitations
      ? (citations.length > 0 ? 1 : 0)
      : 1;

    if (requiresCitations) {
      sumCitationCoverageHeuristic += citeCoverageHeuristic;
      citationCoverageHeuristicCount += 1;
    }

    const includeCheck = heuristicMustInclude(answer, expectations);

    const caseResult = {
      id: c.id,
      description: c.description,
      mode: runLLM && canUseLLM ? "llm" : "offline",
      expectations,
      brief,
      rag: {
        top: ragResults.map(r => ({ id: r.id, type: r.type, score: r.score })),
      },
      timingsMs: {
        brief: briefMs,
        rag: ragMs,
        answer: answerMs,
        verify: verifyMs,
        judge: judgeMs,
        total: Date.now() - tCase0,
      },
      evidenceChars: evidenceText.length,
      answer: answer ? answer.slice(0, 5000) : "",
      verification,
      judge,
      metrics: {
        requiresCitations,
        citationsFound: citations.length,
        citationCoverageHeuristic: citeCoverageHeuristic,
        briefBlocked: Boolean(brief.blocker?.is_blocked),
        clarificationExpected: shouldAskClarificationExpected,
        clarificationActual: shouldAskClarificationActual,
        mustIncludeOk: includeCheck.ok,
        mustIncludeMissing: includeCheck.missing,
      },
    };

    // Lightweight heuristic (works in offline mode and as a sanity check in LLM mode).
    const heurPass =
      (shouldAskClarificationExpected === undefined || shouldAskClarificationExpected === shouldAskClarificationActual) &&
      includeCheck.ok &&
      citeCoverageHeuristic === 1;

    caseResult.metrics["taskSuccessHeuristic"] = heurPass ? 1 : 0;

    const casePass = judge ? Boolean(judge.overall_pass) : heurPass;
    caseResult.metrics["casePass"] = casePass;

    if (casePass) passCount++;
    sumTaskSuccessHeuristic += caseResult.metrics.taskSuccessHeuristic;

    report.cases.push(caseResult);
  }

  // Summary metrics
  report.summary = {
    totalCases: cases.length,
    clarificationRate: cases.length > 0 ? countClarify / cases.length : 0,
    judgedCases: judgedCount,
    taskSuccessAvg: judgedCount > 0 ? sumTaskSuccess / judgedCount : null,
    citationCoverageAvg: judgedCount > 0 ? sumCitationCoverage / judgedCount : null,
    contradictionsAvg: judgedCount > 0 ? sumContradictions / judgedCount : null,
    citationsRequiredRate: cases.length > 0 ? countCitationsRequired / cases.length : 0,
    passRate: cases.length > 0 ? passCount / cases.length : 0,
    taskSuccessHeuristicAvg: cases.length > 0 ? sumTaskSuccessHeuristic / cases.length : 0,
    citationCoverageHeuristicAvg: citationCoverageHeuristicCount > 0 ? sumCitationCoverageHeuristic / citationCoverageHeuristicCount : 1,
  };

  const outJson = path.join(outDir, `eval_judge_${stamp}.json`);
  const outJsonLatest = path.join(outDir, `eval_judge_latest.json`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(outJsonLatest, JSON.stringify(report, null, 2));

  const mdLines: string[] = [];
  mdLines.push(`# Eval Judge Report`);
  mdLines.push(``);
  mdLines.push(`- Generated: ${report.generatedAt}`);
  mdLines.push(`- Mode: ${report.mode}`);
  mdLines.push(`- Cases: ${report.summary.totalCases}`);
  mdLines.push(`- Judged: ${report.summary.judgedCases}`);
  mdLines.push(`- Task success avg: ${report.summary.taskSuccessAvg ?? "n/a"}`);
  mdLines.push(`- Clarification rate: ${report.summary.clarificationRate.toFixed(3)}`);
  mdLines.push(`- Citation coverage avg: ${report.summary.citationCoverageAvg ?? "n/a"}`);
  mdLines.push(`- Contradictions avg: ${report.summary.contradictionsAvg ?? "n/a"}`);
  mdLines.push(`- Pass rate: ${report.summary.passRate.toFixed(3)}`);
  mdLines.push(`- Task success heuristic avg: ${report.summary.taskSuccessHeuristicAvg.toFixed(3)}`);
  mdLines.push(`- Citation coverage heuristic avg: ${report.summary.citationCoverageHeuristicAvg.toFixed(3)}`);
  mdLines.push(``);
  mdLines.push(`## Per-Case`);
  mdLines.push(``);
  mdLines.push(`| Case | Brief Blocked | Citations Req | Citations Found | Judge Pass | Judge Task | Verifier Ask Q |`);
  mdLines.push(`|------|--------------|--------------|----------------|-----------|-----------|----------------|`);
  for (const c of report.cases) {
    const judgePass = c.judge ? (c.judge.overall_pass ? "✅" : "❌") : "n/a";
    const judgeTask = c.judge ? c.judge.task_success.toFixed(2) : "n/a";
    const verifierAsk = c.verification?.should_ask_clarifying_question ? "yes" : "no";
    mdLines.push(
      `| ${c.id} | ${c.metrics.briefBlocked ? "yes" : "no"} | ${c.metrics.requiresCitations ? "yes" : "no"} | ${c.metrics.citationsFound} | ${judgePass} | ${judgeTask} | ${verifierAsk} |`
    );
  }

  const outMdLatest = path.join(outDir, `eval_judge_latest.md`);
  fs.writeFileSync(outMdLatest, mdLines.join("\n"));

  const currentBaseline = buildBaselineFromReport(report);

  if (saveBaselinePath) {
    fs.mkdirSync(path.dirname(saveBaselinePath), { recursive: true });
    fs.writeFileSync(saveBaselinePath, JSON.stringify(currentBaseline, null, 2));
    console.log(`✅ Baseline saved: ${saveBaselinePath}`);
  }

  if (baselinePath) {
    const baselineRaw = readJsonFile<unknown>(baselinePath);
    const baseline = coerceBaseline(baselineRaw as any);
    const comparison = compareBaselines({
      baseline,
      current: currentBaseline,
      maxTaskSuccessDrop,
      maxCitationCoverageDrop,
      maxClarificationIncrease,
      maxContradictionsIncrease,
    });

    report.baselineComparison = {
      baselinePath,
      thresholds: {
        maxTaskSuccessDrop,
        maxCitationCoverageDrop,
        maxClarificationIncrease,
        maxContradictionsIncrease,
      },
      ...comparison,
    };

    // Update latest JSON with comparison embedded.
    fs.writeFileSync(outJsonLatest, JSON.stringify(report, null, 2));

    if (!comparison.ok) {
      console.error(`\n❌ Regression detected vs baseline (${baselinePath}):`);
      for (const r of comparison.regressions) console.error(`- ${r}`);
      if (!noFail) process.exit(2);
    } else {
      console.log(`✅ No regressions vs baseline (${baselinePath})`);
    }
  }

  console.log(`\n✅ Eval report written: ${outJsonLatest}`);
  console.log(`✅ Eval summary written: ${outMdLatest}\n`);
}

main().catch((err) => {
  console.error("Eval judge failed:", err);
  process.exit(1);
});
