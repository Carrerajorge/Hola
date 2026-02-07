import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { zodToJsonSchema } from "zod-to-json-schema";
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

const RequestBriefJsonSchema = zodToJsonSchema(RequestBriefSchema, {
  name: "RequestBrief",
});

function extractJsonObject(text: string): unknown {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Empty LLM output");

  try {
    return JSON.parse(trimmed);
  } catch {
    // Best-effort: strip code fences and surrounding text.
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("No JSON object found in LLM output");
    }
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }
}

export function requestUnderstandingFallbackBrief(input: RequestUnderstandingInput, reason?: string): RequestBrief {
  const text = (input.text || "").trim();
  const lower = text.toLowerCase();
  const hasAttachments = (input.attachments || []).length > 0;

  const referencesPreviousDoc =
    /\b(lo|la)\s+anterior\b/i.test(text) ||
    /\b(documento|doc|archivo|texto)\s+(anterior|previo|previa|de antes)\b/i.test(text);

  const restrictions: Array<{ constraint: string; hard: boolean }> = [];
  if (/\b(sin\s+buscar|no\s+busques|sin\s+fuentes)\b/i.test(text)) {
    restrictions.push({ constraint: "No realizar busqueda externa ni inventar fuentes.", hard: true });
  }

  const blocker = (() => {
    if (referencesPreviousDoc && !hasAttachments) {
      return {
        is_blocked: true,
        question: "Para mejorar el documento anterior, pegalo aqui o adjuntalo (o decime el nombre exacto del archivo en este chat).",
      };
    }
    if (!text) {
      return {
        is_blocked: true,
        question: "Cual es el pedido exacto y que entregable queres que produzca?",
      };
    }
    return { is_blocked: false as const };
  })();

  const brief: RequestBrief = {
    intent: {
      primary_intent: text ? `Resolver el encargo: ${text.slice(0, 140)}` : "Resolver el encargo del usuario",
      confidence: 0.45,
    },
    subtasks: [
      {
        title: "Entender el pedido",
        description: "Construir un brief canonico con intencion, restricciones, datos y criterios de exito.",
        priority: "high",
      },
      {
        title: "Ejecutar y verificar",
        description: "Producir el entregable solicitado y validar coherencia, citas y faltantes.",
        priority: "high",
      },
    ],
    deliverable: {
      description: /documento|brief|plan|pipeline/i.test(text)
        ? "Documento tecnico con especificacion y cambios implementables"
        : "Respuesta util y accionable",
      format: /json schema|schema/i.test(lower)
        ? "JSON + explicacion breve"
        : /markdown/i.test(lower)
          ? "Markdown"
          : "Texto",
    },
    audience: {
      audience: "equipo tecnico",
      tone: "direct",
      language: "es",
    },
    restrictions,
    data_provided: [
      ...(text ? [{ key: "input_text", value: text, source: "provided" as const }] : []),
      ...(input.attachments || []).map((a) => ({
        key: `attachment:${a.name || "sin_nombre"}`,
        value: { type: a.type, extractedTextPreview: (a.extractedText || "").slice(0, 300) },
        source: "extracted" as const,
      })),
    ],
    assumptions: [
      ...(reason ? [`Fallback brief usado por error/indisponibilidad del LLM: ${reason}`] : []),
      ...(referencesPreviousDoc && !hasAttachments ? ["El usuario se refiere a un documento previo que no esta disponible en el input actual."] : []),
    ],
    success_criteria: [
      "El brief mantiene el formato canonico (schema) sin perder campos.",
      "Si falta informacion critica, se formula una sola pregunta aclaratoria.",
    ],
    risks: [
      ...(referencesPreviousDoc && !hasAttachments
        ? [{ risk: "No hay documento base para mejorar; alto riesgo de inventar contenido.", severity: "high" as const }]
        : []),
      ...(lower.includes("github")
        ? [{ risk: "Subida a GitHub puede fallar por permisos/llaves SSH en el entorno.", severity: "medium" as const }]
        : []),
    ],
    ambiguities: [
      ...(lower.includes("mejora") && !lower.includes("que") ? ["No se especifica que aspecto mejorar (estructura, tono, contenido, formato, etc.)."] : []),
    ],
    blocker: {
      is_blocked: blocker.is_blocked,
      question: (blocker as any).question,
    },
  };

  return RequestBriefSchema.parse(brief);
}

function buildPrompt(input: RequestUnderstandingInput): ChatCompletionMessageParam[] {
  const attachments = input.attachments?.length
    ? input.attachments
        .map((a, i) => `ATTACHMENT[${i + 1}] (${a.type}) ${a.name ?? ""}\n${a.extractedText}`)
        .join("\n\n")
    : "(none)";

  const system = `Eres un Agente de Comprension de Pedido (Request-Understanding).
Debes producir un brief canonico que siga el schema. Salida: UN SOLO objeto JSON.
Sin markdown. Sin comentarios. Sin texto extra.

Reglas:
- Extrae la intencion principal y traduce el pedido a un encargo claro.
- Subtareas: 2 a 5 (no mas, no menos).
- Entregable: descripcion exacta + formato.
- Audiencia/tono/idioma: por defecto "es" y tono "direct".
- Restricciones: detecta "sin buscar", "sin fuentes", presupuestos, aprobaciones, etc.
- Datos: separa lo aportado vs supuestos.
- Criterios de exito: 2 a 6 items si aplica.
- Riesgos/ambiguedades: lista corta y concreta.
- Si esta bloqueado: blocker.is_blocked=true y UNA SOLA pregunta en blocker.question (exactamente una).`;

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

    const responseFormats: Array<{ label: string; value?: unknown }> = [
      {
        label: "json_schema",
        value: {
          type: "json_schema",
          json_schema: {
            name: "RequestBrief",
            schema: RequestBriefJsonSchema,
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
            maxTokens: 1200,
            enableFallback: true,
            responseFormat: rf.value,
          });

          const raw = (res.content || "").trim();
          const json = extractJsonObject(raw);
          const brief = RequestBriefSchema.parse(json);

          if (brief.blocker?.is_blocked) {
            brief.blocker.question = (brief.blocker.question || "").trim();
            if (!brief.blocker.question) {
              brief.blocker.question = "¿Qué información falta para poder completar el encargo?";
            }
          }

          return brief;
        } catch (err: any) {
          lastErr = err;
          Logger.warn(
            `[RequestUnderstanding] brief failed format=${rf.label} attempt=${attempt + 1}: ${err?.message || err}`
          );

          messages.push({ role: "assistant", content: "{\"error\":\"previous_output_invalid\"}" });
          messages.push({
            role: "user",
            content: `Salida invalida. Devuelve SOLO JSON valido que cumpla el schema. Error: ${err?.message || err}`,
          });
        }
      }
    }

    // Mandatory gate must never take the system down: return schema-valid fallback.
    return requestUnderstandingFallbackBrief(input, lastErr?.message || String(lastErr || "unknown"));
  }
}

export const requestUnderstandingAgent = new RequestUnderstandingAgent();
