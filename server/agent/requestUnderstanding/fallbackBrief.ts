import { RequestBriefSchema, type RequestBrief } from "./briefSchema";
import type { RequestUnderstandingInput } from "./types";

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

