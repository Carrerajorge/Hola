import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { generateStructuredOutput } from "../../lib/structuredOutput";
import { CanonicalBriefSchema, type CanonicalBrief } from "./briefSchema";

export interface BriefAttachmentSummary {
  id: string;
  kind: "document" | "image" | "web";
  label: string;
  mimeType?: string;
  summary: string;
  citationHint?: string; // e.g. "doc:foo.pdf" or "img:123"
}

export async function buildCanonicalBrief(args: {
  userMessage: string;
  conversationContext?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  attachments?: BriefAttachmentSummary[];
  requestId?: string;
  userId?: string;
  model?: string;
}): Promise<{ brief: CanonicalBrief; raw: string; attempts: number }> {
  const {
    userMessage,
    conversationContext = [],
    attachments = [],
    requestId,
    userId,
    model = "gemini-2.5-flash",
  } = args;

  const contextWindow = conversationContext
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map(m => ({ role: m.role, content: m.content.slice(0, 900) }));

  const attachmentsForPrompt = attachments.map(a => ({
    id: a.id,
    kind: a.kind,
    label: a.label,
    mimeType: a.mimeType,
    citationHint: a.citationHint,
    summary: a.summary.slice(0, 1500),
  }));

  const prompt = [
    `Construye un Brief canónico del encargo (NO la respuesta).`,
    `Debe ser fiel al pedido y a lo aportado en adjuntos/imágenes/web.`,
    `Si falta un dato imprescindible para cumplir el entregable, marca blocker.is_blocked=true y escribe UNA sola pregunta aclaratoria (blocker.clarification_question).`,
    `Si NO está bloqueado, blocker.is_blocked=false y blocker.clarification_question=null.`,
    `No inventes contenido de adjuntos: usa solo los resúmenes provistos.`,
    ``,
    `USER_MESSAGE:\n${userMessage}`,
    ``,
    `CONVERSATION_CONTEXT (últimos turnos, puede estar incompleto):\n${JSON.stringify(contextWindow)}`,
    ``,
    `ATTACHMENTS_SUMMARY:\n${JSON.stringify(attachmentsForPrompt)}`,
    ``,
    `Notas:`,
    `- subtasks: 2 a 5.`,
    `- deliverable.format debe ser uno de: plain_text, markdown, json, csv, code, docx, xlsx, pptx, pdf.`,
    `- inputs.provided: lista de items + su source (p.ej. "message", "doc:archivo.pdf p3", "img:123").`,
    `- inputs.assumed: solo supuestos explícitos, no hechos.`,
  ].join("\n");

  const messages: ChatCompletionMessageParam[] = [{ role: "user", content: prompt }];

  try {
    const out = await generateStructuredOutput({
      messages,
      schema: CanonicalBriefSchema,
      schemaName: "CanonicalBrief",
      model,
      provider: "auto",
      temperature: 0.1,
      maxTokens: 1200,
      userId,
      requestId,
      maxRetries: 2,
      timeoutMs: 30000,
    });

    return { brief: out.value, raw: out.raw, attempts: out.attempts };
  } catch (err) {
    // Hard fallback: keep shape stable, but be explicit about assumptions.
    const fallback: CanonicalBrief = {
      brief_version: "1.0",
      primary_intent: userMessage.trim().slice(0, 300) || "Responder la solicitud del usuario",
      subtasks: [
        { title: "Resolver", description: "Resolver el pedido principal del usuario con el mejor resultado posible." },
        { title: "Control de calidad", description: "Evitar inventar datos; pedir 1 aclaración si falta información imprescindible." },
      ],
      deliverable: {
        exact: "Respuesta al usuario acorde al pedido.",
        format: "markdown",
      },
      audience_tone: {
        audience: "Usuario final",
        tone: "Directo, profesional",
        language: "es",
      },
      restrictions: [],
      inputs: {
        provided: [{ item: userMessage.slice(0, 500), source: "message" }],
        assumed: ["No se aportaron más restricciones explícitas; se asume formato estándar en español."],
      },
      success_criteria: ["La respuesta cumple el encargo y no inventa contexto no aportado."],
      risks_ambiguities: [
        {
          issue: "El brief cayó en fallback por error de estructuración; puede perder matices de intención/subtareas.",
          mitigation: "Reintentar brief con un modelo alternativo o reducir la complejidad del prompt.",
        },
      ],
      blocker: { is_blocked: false, clarification_question: null },
    };

    return { brief: fallback, raw: "", attempts: 0 };
  }
}

