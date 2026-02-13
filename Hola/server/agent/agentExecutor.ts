import { z } from "zod";
import type { Response } from "express";
import { toolRegistry, type ToolContext, type ToolResult } from "./toolRegistry";
import { emitTraceEvent } from "./unifiedChatHandler";
import type { RequestSpec } from "./requestSpec";
import { renderPresentation, renderDocument, renderSpreadsheet } from "./artifactRenderer";
import { PresentationSpecSchema, DocSpecSchema, SheetSpecSchema } from "./builderSpec";
import { randomUUID } from "crypto";
import { getGeminiClientOrThrow } from "../lib/gemini";

export interface AgentExecutorOptions {
  maxIterations?: number;
  timeout?: number;
  runId: string;
  userId: string;
  chatId: string;
  requestSpec: RequestSpec;
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: "web_search",
    description: "Search the web for current information on any topic",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        maxResults: { type: "number", description: "Maximum results (default 5)" }
      },
      required: ["query"]
    }
  },
  {
    name: "fetch_url",
    description: "Fetch and extract text content from a URL",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        extractText: { type: "boolean", description: "Extract readable text (default true)" }
      },
      required: ["url"]
    }
  },
  {
    name: "browse_and_act",
    description: "Open a real browser and autonomously accomplish a goal: navigate websites, fill forms, click buttons, make reservations, purchases, etc. Use this when you need to INTERACT with a website (not just read it). The browser uses AI vision to analyze pages and decide actions automatically.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Starting URL to navigate to (e.g., https://www.mesa247.pe)" },
        goal: { type: "string", description: "Detailed description of what to accomplish (e.g., 'Make a reservation for 2 people on February 15, 2026 at 8:00 PM at a restaurant in Lima')" },
        maxSteps: { type: "number", description: "Maximum browser actions to take (default 20)" }
      },
      required: ["url", "goal"]
    }
  },
  {
    name: "create_presentation",
    description: "Create a PowerPoint presentation with slides",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Presentation title" },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              layout: { type: "string", enum: ["title", "content", "twoColumn", "imageLeft", "imageRight"] }
            }
          },
          description: "Array of slide definitions"
        },
        theme: { type: "string", description: "Theme name (default 'professional')" }
      },
      required: ["title", "slides"]
    }
  },
  {
    name: "create_document",
    description: "Create a Word document with sections and content",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              content: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              level: { type: "number" }
            }
          },
          description: "Document sections"
        }
      },
      required: ["title", "sections"]
    }
  },
  {
    name: "create_spreadsheet",
    description: "Create an Excel spreadsheet with data",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Spreadsheet title" },
        sheets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              headers: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array" } }
            }
          },
          description: "Sheet definitions"
        }
      },
      required: ["title", "sheets"]
    }
  },
  {
    name: "analyze_data",
    description: "Analyze data and provide statistical insights",
    parameters: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data to analyze (JSON, CSV, or description)" },
        analysisType: { type: "string", enum: ["summary", "trends", "comparison", "forecast"] }
      },
      required: ["data"]
    }
  },
  {
    name: "generate_chart",
    description: "Generate a chart visualization",
    parameters: {
      type: "object",
      properties: {
        chartType: { type: "string", enum: ["bar", "line", "pie", "scatter", "area"] },
        title: { type: "string" },
        data: { type: "object", description: "Chart data with labels and values" }
      },
      required: ["chartType", "data"]
    }
  }
];

import { zodToJsonSchema } from "zod-to-json-schema";

function getToolsForIntent(intent: string): FunctionDeclaration[] {
  switch (intent) {
    case "research":
      return AGENT_TOOLS.filter(t => ["web_search", "fetch_url"].includes(t.name));
    case "presentation_creation":
      return AGENT_TOOLS.filter(t => ["create_presentation", "web_search"].includes(t.name));
    case "document_generation":
      return AGENT_TOOLS.filter(t => ["create_document", "web_search"].includes(t.name));
    case "spreadsheet_creation":
      return AGENT_TOOLS.filter(t => ["create_spreadsheet", "analyze_data"].includes(t.name));
    case "data_analysis":
      return AGENT_TOOLS.filter(t => ["analyze_data", "generate_chart", "create_spreadsheet"].includes(t.name));
    case "web_automation":
      return AGENT_TOOLS.filter(t => ["web_search", "fetch_url", "browse_and_act"].includes(t.name));
    default:
      return AGENT_TOOLS;
  }
}

type ReservationMissingField =
  | "restaurant"
  | "date"
  | "time"
  | "partySize"
  | "contactName"
  | "contactPhone"
  | "contactEmail";

interface ReservationDetails {
  restaurant?: string;
  date?: string;
  time?: string;
  partySize?: number;
  contactName?: string;
  phone?: string;
  email?: string;
  location?: string;
}

const RESERVATION_FIELD_LABELS: Record<ReservationMissingField, string> = {
  restaurant: "restaurante exacto",
  date: "fecha exacta (dia/mes/anio)",
  time: "hora exacta (ej. 20:00 o 8:00 pm)",
  partySize: "cantidad de personas",
  contactName: "nombre para la reserva",
  contactPhone: "telefono de contacto",
  contactEmail: "email de contacto",
};

function normalizeSpaces(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectRecentUserText(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "user")
    .slice(-4)
    .map((m) => normalizeSpaces(m.content))
    .filter(Boolean)
    .join(" ");
}

function isRestaurantReservationRequest(text: string): boolean {
  const normalized = normalizeSpaces(text).toLowerCase();
  if (!normalized) return false;
  const hasReservationVerb = /\b(reserva|reservar|reservacion|reservation|book|booking)\b/i.test(normalized);
  const hasRestaurantTerm = /\b(restaurante|restaurant|mesa|table)\b/i.test(normalized);
  // Also match "reserva en Cala" (known restaurant) or "reserva en [Name] para X personas"
  const hasReservaEnPattern = /\breserva(?:r)?\s+(?:en|at)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+/i.test(normalized);
  // Match "reserva para X personas" (implies restaurant context)
  const hasReservaParaPersonas = /\breserva(?:r|cion)?\b.*\b\d+\s*personas?\b/i.test(normalized);
  return hasReservationVerb && (hasRestaurantTerm || hasReservaEnPattern || hasReservaParaPersonas);
}

function extractReservationDetails(text: string): ReservationDetails {
  const source = normalizeSpaces(text);
  const details: ReservationDetails = {};
  if (!source) return details;

  const partyMatch =
    source.match(/\b(?:para|for)\s+(\d{1,2})\s*(?:personas?|people|guests?|comensales?)\b/i) ||
    source.match(/\b(\d{1,2})\s*(?:personas?|people|guests?|comensales?)\b/i);
  if (partyMatch) {
    const parsed = Number(partyMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) details.partySize = parsed;
  }

  const monthEs = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  const monthEn = "january|february|march|april|may|june|july|august|september|october|november|december";
  const datePatterns: RegExp[] = [
    /\b\d{4}-\d{2}-\d{2}\b/i,
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})\b/i,
    new RegExp(`\\b\\d{1,2}\\s+de\\s+(?:${monthEs})(?:\\s+de?\\s*\\d{4})?\\b`, "i"),
    new RegExp(`\\b(?:${monthEn})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, "i"),
    /\b(?:hoy|manana|mañana|today|tomorrow)\b/i,
    /\b(?:d[ií]a|el)\s+(\d{1,2})\b/i,
  ];
  for (const pattern of datePatterns) {
    const match = source.match(pattern);
    if (match?.[0]) {
      details.date = normalizeSpaces(match[0]);
      break;
    }
  }

  const timeMatch =
    source.match(/\b(?:a las|at)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/i) ||
    source.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i) ||
    source.match(/\b(\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))\b/i);
  if (timeMatch?.[1]) {
    details.time = normalizeSpaces(timeMatch[1]);
  }

  // Pattern 1 (highest priority): "restaurante [Name]" — name comes AFTER "restaurante" (e.g., "restaurante Cala")
  const restaurantAfterKeyword = source.match(
    /\b(?:restaurante|restaurant)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)(?:\s|$|,)/i
  );
  // Pattern 2: "en [Name] restaurante" — name comes BEFORE "restaurante" (e.g., "en Cala restaurante")
  // Skip articles (el, la, los, las, the) that may appear before "restaurante"
  const restaurantBeforeKeyword = source.match(
    /\b(?:reserva(?:r)?|book(?:ing)?)\s+(?:mesa|table)?\s*(?:en|at)\s+(?:el\s+|la\s+|los\s+|las\s+|the\s+)?(.+?)\s+(?:restaurante|restaurant)\b/i
  );
  // Pattern 3: "reserva en [Name]" — broader fallback (name after "en" not followed by common stopwords)
  const restaurantByReservePattern = source.match(
    /\b(?:reserva(?:r)?|book(?:ing)?)\s+(?:mesa|table)?\s*(?:en|at)\s+(?:el\s+|la\s+|the\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)(?:\s|$|,)/i
  );
  // Priority: afterKeyword > beforeKeyword > byReservePattern
  const restaurantRaw = restaurantAfterKeyword?.[1] || restaurantBeforeKeyword?.[1] || restaurantByReservePattern?.[1];
  if (restaurantRaw) {
    // Clean up: remove leading articles and trailing punctuation
    details.restaurant = normalizeSpaces(restaurantRaw.replace(/^(?:en|el|la|los|las|the)\s+/i, "").replace(/[,;.]$/, ""));
  }

  // Prefer "restaurante en [City]" pattern — capture single word city name (no spaces to avoid greediness)
  const locationAfterRestaurant = source.match(
    /\b(?:restaurante|restaurant)\s+(?:en|in|de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)(?:\s|,|$)/i
  );
  const locationGeneric = source.match(
    /\b(?:en|in)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)\s+(?:para|for|el|on|a las|at)\b/i
  );
  const locationMatch = locationAfterRestaurant || locationGeneric;
  if (locationMatch?.[1]) {
    // Avoid setting location to the restaurant name itself
    const loc = normalizeSpaces(locationMatch[1]);
    if (loc.toLowerCase() !== (details.restaurant || "").toLowerCase()) {
      details.location = loc;
    }
  }
  if (!details.location && details.restaurant) {
    const cityFromRestaurant = details.restaurant.match(/\bde\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\- ]{2,40})$/i);
    if (cityFromRestaurant?.[1]) {
      details.location = normalizeSpaces(cityFromRestaurant[1]);
    }
  }

  const emailMatch = source.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (emailMatch?.[0]) {
    details.email = emailMatch[0];
  }

  const sourceWithoutEmails = source.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ");
  const labeledPhoneMatch = sourceWithoutEmails.match(
    /\b(?:telefono|tel[eé]fono|phone|cel|celular|whatsapp|n[uú]mero|mi\s+numero)\b\s*(?:es|de|:|\-)?\s*(\+?\d[\d\s().-]{7,}\d)\b/i
  );
  if (labeledPhoneMatch?.[1]) {
    const candidate = normalizeSpaces(labeledPhoneMatch[1]);
    const digitCount = candidate.replace(/\D/g, "").length;
    if (digitCount >= 8 && digitCount <= 15) {
      details.phone = candidate;
    }
  }

  if (!details.phone) {
    const loosePhoneMatches = sourceWithoutEmails.match(/\+?\d[\d\s().-]{8,}\d/g) || [];
    for (const rawMatch of loosePhoneMatches) {
      const candidate = normalizeSpaces(rawMatch);
      if (/[:/]/.test(candidate)) continue; // avoid date/time-like tokens
      const digitCount = candidate.replace(/\D/g, "").length;
      if (digitCount >= 8 && digitCount <= 15) {
        details.phone = candidate;
        break;
      }
    }
  }

  const nameMatch = source.match(
    /\b(?:a nombre de|(?:mi\s+)?nombre(?:\s+(?:de|es))?|name(?:\s+is)?|my name is|me llamo|soy)\s*[:\-]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ'\- ]{2,60})/i
  );
  if (nameMatch?.[1]) {
    const cleaned = normalizeSpaces(nameMatch[1]).split(/\b(?:telefono|tel|phone|email|correo|a\s+las|para|n[uú]mero|mi\s+numero|mi\s+correo|mi\s+tel)\b/i)[0].trim();
    if (cleaned.length >= 2) {
      details.contactName = cleaned;
    }
  }

  return details;
}

function getMissingReservationFields(details: ReservationDetails): ReservationMissingField[] {
  const missing: ReservationMissingField[] = [];
  if (!details.restaurant) missing.push("restaurant");
  if (!details.date) missing.push("date");
  if (!details.time) missing.push("time");
  if (!details.partySize) missing.push("partySize");
  if (!details.contactName) missing.push("contactName");
  if (!details.phone) missing.push("contactPhone");
  if (!details.email) missing.push("contactEmail");
  return missing;
}

function formatReservationDetails(details: ReservationDetails): string {
  const parts: string[] = [];
  if (details.restaurant) parts.push(`restaurante="${details.restaurant}"`);
  if (details.location) parts.push(`ciudad="${details.location}"`);
  if (details.date) parts.push(`fecha="${details.date}"`);
  if (details.time) parts.push(`hora="${details.time}"`);
  if (details.partySize) parts.push(`personas=${details.partySize}`);
  if (details.contactName) parts.push(`nombre="${details.contactName}"`);
  if (details.phone) parts.push(`telefono="${details.phone}"`);
  if (details.email) parts.push(`email="${details.email}"`);
  return parts.join(", ");
}

function buildReservationClarificationQuestion(
  details: ReservationDetails,
  missingFields: ReservationMissingField[]
): string {
  const knownParts: string[] = [];
  if (details.restaurant) knownParts.push(`**Restaurante:** ${details.restaurant}`);
  if (details.location) knownParts.push(`**Ciudad:** ${details.location}`);
  if (details.date) knownParts.push(`**Fecha:** ${details.date}`);
  if (details.time) knownParts.push(`**Hora:** ${details.time}`);
  if (details.partySize) knownParts.push(`**Personas:** ${details.partySize}`);
  if (details.contactName) knownParts.push(`**Nombre:** ${details.contactName}`);
  if (details.phone) knownParts.push(`**Teléfono:** ${details.phone}`);
  if (details.email) knownParts.push(`**Email:** ${details.email}`);

  const knownBlock = knownParts.length > 0
    ? `✅ **Datos detectados:**  \n${knownParts.join("  \n")}\n\n`
    : "";
  const missingList = missingFields.map((field) => `- ${RESERVATION_FIELD_LABELS[field]}`).join("\n");
  return `${knownBlock}📋 **Para completar la reserva necesito estos datos:**\n${missingList}\n\nCompártelos en un solo mensaje y continúo con la reserva real en la web.`;
}

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  context: ToolContext,
  runId: string,
  sseRes?: Response,
  preExtractedReservation?: ReservationDetails
): Promise<{ result: any; artifact?: { type: string; url: string; name: string } }> {
  console.log(`[AgentExecutor] Executing tool: ${toolName}`, args);

  await emitTraceEvent(runId, "tool_call_started", {
    toolCall: {
      id: randomUUID(),
      name: toolName,
      input: args,
      status: "running"
    }
  });

  const startTime = Date.now();
  let result: any;
  let artifact: { type: string; url: string; name: string } | undefined;

  try {
    switch (toolName) {
      case "web_search": {
        try {
          // Use DuckDuckGo search directly (avoids toolRegistry network policy blocks)
          const { searchWeb } = await import("../services/webSearch");
          const searchResult = await searchWeb(args.query, args.maxResults || 5);
          result = searchResult.results?.length > 0
            ? searchResult.results.map((r: any) => ({ title: r.title, url: r.url, snippet: r.snippet }))
            : { message: "No results found", query: args.query };
        } catch (err: any) {
          // Fallback to toolRegistry
          const searchResult = await toolRegistry.execute("search", {
            query: args.query,
            maxResults: args.maxResults || 5
          }, context);
          result = searchResult.success ? searchResult.output : { error: searchResult.error?.message };
        }
        break;
      }

      case "fetch_url": {
        try {
          const { fetchUrl } = await import("../services/webSearch");
          const fetchResult = await fetchUrl(args.url, {
            extractText: args.extractText ?? true,
            maxLength: 50000
          });
          result = fetchResult;
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "browse_and_act": {
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
        try {
          const { universalBrowserController } = await import("./computerUse/universalBrowserController");
          const sessionId = await universalBrowserController.createSession("chrome-desktop");
          const goalText = String(args.goal || "");
          const isReservationGoal = /\b(reserv(a|ar|ation)|book(ing)?|mesa|restaurant|restaurante)\b/i.test(goalText);
          const normalizedGoal = goalText.toLowerCase();
          const isCalaReservation = isReservationGoal && /\bcala\b/i.test(normalizedGoal);
          const goalDetails = isReservationGoal ? extractReservationDetails(goalText) : undefined;
          // Merge: prefer pre-extracted details from user's original message, fill gaps from goal text
          const reservationDetailsFromGoal = isReservationGoal
            ? {
                ...goalDetails,
                ...(preExtractedReservation || {}),
                // Keep goal details only where pre-extracted is empty
                restaurant: preExtractedReservation?.restaurant || goalDetails?.restaurant,
                date: preExtractedReservation?.date || goalDetails?.date,
                time: preExtractedReservation?.time || goalDetails?.time,
                partySize: preExtractedReservation?.partySize || goalDetails?.partySize,
                contactName: preExtractedReservation?.contactName || goalDetails?.contactName,
                email: preExtractedReservation?.email || goalDetails?.email,
                phone: preExtractedReservation?.phone || goalDetails?.phone,
              }
            : undefined;
          const requestedUrl = String(args.url || "");
          const effectiveUrl = isCalaReservation
            ? "https://www.covermanager.com/reserve/module_restaurant/cala-restaurante/spanish"
            : (requestedUrl || "https://www.mesa247.pe");
          console.log(`[AgentExecutor] Browser session created: ${sessionId}, navigating to ${effectiveUrl}`);
          const requestedMaxSteps = Number.isFinite(Number(args.maxSteps)) ? Number(args.maxSteps) : undefined;
          // Allow up to 20 steps, 3 minutes total runtime, 25s per Gemini vision decision
          const maxSteps = Math.max(1, Math.min(requestedMaxSteps ?? 15, 20));
          const maxRuntimeMs = 180000;  // 3 minutes max
          const decisionTimeoutMs = 25000;  // 25s per Gemini vision decision
          try {
            // Send immediate "browser_started" event so the UI opens the virtual computer immediately
            if (sseRes) {
              try {
                const r = sseRes as any;
                if (!r.writableEnded && !r.destroyed) {
                  sseRes.write(`event: browser_step\ndata: ${JSON.stringify({
                    runId,
                    stepNumber: 0,
                    totalSteps: maxSteps,
                    action: "navigate",
                    reasoning: `Abriendo navegador y navegando a ${effectiveUrl}...`,
                    goalProgress: "0%",
                    screenshot: "",
                    url: effectiveUrl,
                    title: "Cargando...",
                  })}\n\n`);
                  if (typeof r.flush === "function") r.flush();
                }
              } catch {}
            }

            await universalBrowserController.navigate(sessionId, effectiveUrl);

            // Start heartbeat: sends keep-alive events every 5s during long operations
            if (sseRes) {
              heartbeatInterval = setInterval(() => {
                try {
                  const r = sseRes as any;
                  if (!r.writableEnded && !r.destroyed) {
                    sseRes.write(`event: heartbeat\ndata: ${JSON.stringify({ runId, timestamp: Date.now() })}\n\n`);
                    if (typeof r.flush === "function") r.flush();
                  } else {
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                  }
                } catch {
                  if (heartbeatInterval) clearInterval(heartbeatInterval);
                }
              }, 5000);
            }

            // Real-time step callback: sends browser_step SSE events with screenshots
            // Also sends browser_report events for inline chat display
            const onBrowserStep = (step: {
              stepNumber: number;
              totalSteps: number;
              action: string;
              reasoning: string;
              goalProgress: string;
              screenshot: string;
              url: string;
              title: string;
            }) => {
              try {
                if (!sseRes) return;
                // Emit browser_step event with screenshot for real-time UI (VirtualComputer)
                const r = sseRes as any;
                if (!r.writableEnded && !r.destroyed) {
                  const sseData = {
                    runId,
                    stepNumber: step.stepNumber,
                    totalSteps: step.totalSteps,
                    action: step.action,
                    reasoning: step.reasoning,
                    goalProgress: step.goalProgress,
                    screenshot: step.screenshot, // base64 JPEG
                    url: step.url,
                    title: step.title,
                  };
                  sseRes.write(`event: browser_step\ndata: ${JSON.stringify(sseData)}\n\n`);
                  // Also emit browser_report for inline chat step display
                  // Emit for ALL steps (not just ones with screenshots) so user sees every action
                  if (step.stepNumber > 0) {
                    sseRes.write(`event: browser_report\ndata: ${JSON.stringify({
                      runId,
                      stepNumber: step.stepNumber,
                      action: step.action,
                      reasoning: step.reasoning,
                      goalProgress: step.goalProgress,
                      screenshot: step.screenshot || "",
                      url: step.url,
                    })}\n\n`);
                  }
                  if (typeof (sseRes as any).flush === "function") {
                    (sseRes as any).flush();
                  }
                }
              } catch (sseErr) {
                console.warn(`[AgentExecutor] SSE browser_step write error:`, sseErr);
              }
            };

            const taskResult = isCalaReservation
              ? await (async () => {
                const missingFields = reservationDetailsFromGoal
                  ? getMissingReservationFields(reservationDetailsFromGoal)
                  : (["restaurant", "date", "time", "partySize", "contactName", "contactPhone", "contactEmail"] as string[]);
                if (missingFields.length > 0) {
                  return {
                    success: false,
                    steps: ["Cala reservation requires additional user data before execution."],
                    data: {
                      status: "needs_user_input",
                      missingFields,
                      question: `Para reservar en Cala necesito: ${missingFields.join(", ")}.`,
                    },
                    screenshots: [],
                  };
                }
                return universalBrowserController.runCalaReservation(
                  sessionId,
                  {
                    restaurant: reservationDetailsFromGoal?.restaurant,
                    date: reservationDetailsFromGoal?.date,
                    time: reservationDetailsFromGoal?.time,
                    partySize: reservationDetailsFromGoal?.partySize,
                    contactName: reservationDetailsFromGoal?.contactName,
                    email: reservationDetailsFromGoal?.email,
                    phone: reservationDetailsFromGoal?.phone,
                  },
                  onBrowserStep,
                  { maxRuntimeMs: 90000 } // 90s: turbo block is fast but browser launch + page load take 15-25s
                );
              })()
              : await universalBrowserController.agenticNavigate(
                sessionId,
                args.goal,
                maxSteps,
                onBrowserStep,
                {
                  maxRuntimeMs,
                  decisionTimeoutMs,
                  maxConsecutiveDecisionFailures: isReservationGoal ? 3 : 2,
                }
              );
            // Stop heartbeat after task completes
            if (heartbeatInterval) clearInterval(heartbeatInterval);

            console.log(`[AgentExecutor] Browser task completed: success=${taskResult.success}, steps=${taskResult.steps.length}, maxSteps=${maxSteps}, runtimeMs=${maxRuntimeMs}`);
            const rawStatus = String(taskResult?.data?.status || "").toLowerCase();
            const hasConfirmationEvidence = Boolean(
              taskResult?.data?.confirmationCode ||
              taskResult?.data?.reservationCode ||
              taskResult?.data?.bookingReference ||
              taskResult?.data?.confirmation
            );
            const explicitNeedsInput = rawStatus === "needs_user_input" || Array.isArray(taskResult?.data?.missingFields);
            let normalizedSuccess = taskResult.success === true;
            if (isReservationGoal) {
              if (explicitNeedsInput) {
                normalizedSuccess = false;
              } else if (rawStatus === "confirmed" || rawStatus === "completed" || rawStatus === "success") {
                normalizedSuccess = true;
              } else if (!hasConfirmationEvidence) {
                normalizedSuccess = false;
              }
              if (!taskResult?.data?.status && !normalizedSuccess) {
                taskResult.data = { ...(taskResult.data || {}), status: "unconfirmed" };
              }
            }
            result = {
              success: normalizedSuccess,
              steps: taskResult.steps,
              data: taskResult.data,
              stepsCount: taskResult.steps.length,
              screenshotsCount: taskResult.screenshots.length,
            };
          } finally {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            await universalBrowserController.closeSession(sessionId).catch(() => {});
            console.log(`[AgentExecutor] Browser session closed: ${sessionId}`);
          }
        } catch (err: any) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          console.error(`[AgentExecutor] browse_and_act error:`, err?.message || err);
          console.error(`[AgentExecutor] browse_and_act stack:`, err?.stack?.split('\n').slice(0, 5).join('\n'));
          result = { error: err.message, details: err?.cause?.message || err?.code || 'unknown' };
        }
        break;
      }

      case "create_presentation": {
        const slideSpec = {
          title: args.title,
          theme: args.theme || "professional",
          slides: args.slides.map((s: any, i: number) => ({
            id: `slide-${i + 1}`,
            layout: s.layout || "content",
            elements: [
              ...(s.title ? [{
                id: `title-${i}`,
                type: "text" as const,
                content: s.title,
                position: { x: 5, y: 5, w: 90, h: 15 },
                style: { fontSize: 32, bold: true, align: "center" as const }
              }] : []),
              ...(s.content ? [{
                id: `content-${i}`,
                type: "text" as const,
                content: s.content,
                position: { x: 5, y: 25, w: 90, h: 60 }
              }] : []),
              ...(s.bullets ? [{
                id: `bullets-${i}`,
                type: "list" as const,
                items: s.bullets,
                position: { x: 5, y: 25, w: 90, h: 60 }
              }] : [])
            ]
          })),
          metadata: { author: context.userId, createdAt: new Date() }
        };

        const validatedSpec = PresentationSpecSchema.parse(slideSpec);
        const { buffer } = await renderPresentation(validatedSpec);
        const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.pptx`;
        const fs = await import("fs/promises");
        const path = await import("path");
        const outputDir = path.join(process.cwd(), "generated_artifacts");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        await fs.writeFile(outputPath, buffer);

        result = { success: true, filename, slidesCount: args.slides.length };
        artifact = { type: "presentation", url: `/api/artifacts/${filename}`, name: filename };

        await emitTraceEvent(runId, "artifact_created", {
          artifact: {
            id: randomUUID(),
            type: "presentation",
            name: filename,
            url: artifact.url,
            size: buffer.length,
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          }
        });
        break;
      }

      case "create_document": {
        const docSpec = {
          title: args.title,
          sections: args.sections.map((s: any, i: number) => ({
            id: `section-${i + 1}`,
            heading: s.heading,
            level: s.level || 1,
            content: s.content ? [{ type: "paragraph" as const, text: s.content }] : [],
            bullets: s.bullets
          })),
          metadata: { author: context.userId, createdAt: new Date() }
        };

        const validatedSpec = DocSpecSchema.parse(docSpec);
        const { buffer } = await renderDocument(validatedSpec);
        const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.docx`;
        const fs = await import("fs/promises");
        const path = await import("path");
        const outputDir = path.join(process.cwd(), "generated_artifacts");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        await fs.writeFile(outputPath, buffer);

        result = { success: true, filename, sectionsCount: args.sections.length };
        artifact = { type: "document", url: `/api/artifacts/${filename}`, name: filename };

        await emitTraceEvent(runId, "artifact_created", {
          artifact: {
            id: randomUUID(),
            type: "document",
            name: filename,
            url: artifact.url,
            size: buffer.length,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }
        });
        break;
      }

      case "create_spreadsheet": {
        const sheetSpec = {
          title: args.title,
          sheets: args.sheets.map((s: any, i: number) => ({
            id: `sheet-${i + 1}`,
            name: s.name || `Sheet${i + 1}`,
            columns: s.headers.map((h: string, j: number) => ({
              id: `col-${j}`,
              header: h,
              type: "text" as const,
              width: 15
            })),
            rows: s.rows.map((row: any[], k: number) => ({
              id: `row-${k}`,
              cells: row.map((cell, l) => ({
                columnId: `col-${l}`,
                value: cell
              }))
            }))
          })),
          metadata: { author: context.userId, createdAt: new Date() }
        };

        const validatedSpec = SheetSpecSchema.parse(sheetSpec);
        const { buffer } = await renderSpreadsheet(validatedSpec);
        const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.xlsx`;
        const fs = await import("fs/promises");
        const path = await import("path");
        const outputDir = path.join(process.cwd(), "generated_artifacts");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        await fs.writeFile(outputPath, buffer);

        result = { success: true, filename, sheetsCount: args.sheets.length };
        artifact = { type: "spreadsheet", url: `/api/artifacts/${filename}`, name: filename };

        await emitTraceEvent(runId, "artifact_created", {
          artifact: {
            id: randomUUID(),
            type: "spreadsheet",
            name: filename,
            url: artifact.url,
            size: buffer.length,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          }
        });
        break;
      }

      case "analyze_data": {
        try {
          // Dynamic import to keep startup fast
          const ss = await import("simple-statistics");

          let parsedData: any[] = [];
          if (typeof args.data === "string") {
            try {
              parsedData = JSON.parse(args.data);
            } catch {
              // Try CSV parsing if JSON fails? For now rely on description or basic numbers
              result = { error: "Could not parse data as JSON" };
            }
          } else if (Array.isArray(args.data)) {
            parsedData = args.data;
          }

          if (parsedData.length > 0) {
            // Extract numeric values if it's an array of objects
            const valueKeys = Object.keys(parsedData[0]).filter(k => typeof parsedData[0][k] === 'number');
            const insights: string[] = [];

            valueKeys.forEach(key => {
              const values = parsedData.map((d: any) => d[key]);
              const mean = ss.mean(values);
              const median = ss.median(values);
              const max = ss.max(values);
              const min = ss.min(values);
              const stdDev = ss.standardDeviation(values);

              insights.push(`Field '${key}': Mean=${mean.toFixed(2)}, Median=${median}, Range=[${min}, ${max}], StdDev=${stdDev.toFixed(2)}`);
            });

            result = {
              summary: `Analysis performed on ${parsedData.length} records.`,
              type: args.analysisType || "statistical",
              insights,
              stats: {
                recordCount: parsedData.length,
                fieldsAnalyzed: valueKeys
              }
            };
          } else {
            result = { error: "No valid data provided for analysis" };
          }
        } catch (e: any) {
          result = { error: `Analysis failed: ${e.message}` };
        }
        break;
      }

      case "generate_chart": {
        // Return a structured Chart.js/Recharts compatible config
        const chartConfig = {
          type: args.chartType,
          data: args.data, // Expects { labels: [], datasets: [{ label: '', data: [] }] }
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: args.title
              },
              legend: {
                position: 'top'
              }
            }
          }
        };

        result = {
          success: true,
          chartType: args.chartType,
          title: args.title,
          config: chartConfig,
          message: "Chart configuration generated successfully"
        };
        break;
      }

      default: {
        const toolResult = await toolRegistry.execute(toolName, args, context);
        result = toolResult.success ? toolResult.output : { error: toolResult.error?.message };
      }
    }

    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_succeeded", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        output: result,
        status: "completed",
        durationMs
      }
    });

    return { result, artifact };

  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_failed", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        status: "failed",
        error: error.message,
        durationMs
      }
    });

    return { result: { error: error.message } };
  }
}

function writeSse(res: Response, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

export async function executeAgentLoop(
  messages: Array<{ role: string; content: string }>,
  res: Response,
  options: AgentExecutorOptions
): Promise<string> {
  const ai = getGeminiClientOrThrow();
  const { runId, userId, chatId, requestSpec, maxIterations = 10 } = options;

  const tools = getToolsForIntent(requestSpec.intent);
  const toolContext: ToolContext = { userId, chatId, runId };

  const artifacts: Array<{ type: string; url: string; name: string }> = [];
  let iteration = 0;
  let conversationHistory = [...messages];
  let fullResponse = "";

  const recentUserText = collectRecentUserText(messages) || requestSpec.rawMessage || "";
  const isReservationRequest =
    requestSpec.intent === "web_automation" && isRestaurantReservationRequest(recentUserText);
  const reservationDetails = isReservationRequest ? extractReservationDetails(recentUserText) : undefined;

  if (isReservationRequest && reservationDetails) {
    const missingFields = getMissingReservationFields(reservationDetails);
    if (missingFields.length > 0) {
      const clarificationQuestion = buildReservationClarificationQuestion(reservationDetails, missingFields);
      fullResponse = clarificationQuestion;
      writeSse(res, "clarification", {
        runId,
        question: clarificationQuestion,
        missingFields,
      });
      // Send as single chunk to preserve markdown formatting
      writeSse(res, "chunk", {
        content: clarificationQuestion,
        sequence: 1,
        runId
      });
      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: 0,
          total: maxIterations,
          message: "Waiting for missing reservation details from user"
        }
      });
      await emitTraceEvent(runId, "agent_completed", {
        agent: {
          name: requestSpec.primaryAgent,
          role: "primary",
          status: "completed"
        },
        iterations: 0,
        artifactsGenerated: 0,
      });
      return fullResponse;
    }
  }

  // For web_automation intent, inject a system hint so the LLM uses browse_and_act
  // We PREPEND it as the first system message for maximum priority
  if (requestSpec.intent === "web_automation") {
    const reservationHint =
      isReservationRequest && reservationDetails
        ? `\nReservation details extracted from the user: ${formatReservationDetails(reservationDetails)}`
        : "";
    conversationHistory.unshift({
      role: "system",
      content: `YOU ARE A WEB AUTOMATION AGENT. YOUR PRIMARY FUNCTION IS TO CALL TOOLS, NOT GENERATE TEXT.

YOU MUST IMMEDIATELY call the "browse_and_act" function to complete the user's request. DO NOT write text responses.

MANDATORY RULES:
1. Your FIRST action MUST be a function call to "browse_and_act" with a URL and goal
2. For restaurant reservations in Peru: url="https://www.mesa247.pe", goal="[full details from user]"
3. For hotel bookings: url="https://www.booking.com"
4. For flights: url="https://www.google.com/travel/flights"
5. For general web tasks: url="https://www.google.com"
6. The browse_and_act tool controls a REAL Chromium browser — it can click, type, scroll, fill forms, navigate
7. Include ALL details in the goal: date, time, number of people, location, contact details, preferences
8. For reservations, only claim success if a real confirmation page or confirmation code is visible.

DO NOT respond with text. CALL browse_and_act NOW.${reservationHint}`
    });
  }

  console.log(`[AgentExecutor] Starting loop: intent=${requestSpec.intent}, tools=[${tools.map(t => t.name).join(', ')}], messages=${conversationHistory.length}, systemMsgs=${conversationHistory.filter(m => m.role === 'system').length}, toolDeclarations=${tools.length}`);

  await emitTraceEvent(runId, "progress_update", {
    progress: {
      current: 0,
      total: maxIterations,
      message: `Starting agent loop with ${tools.length} available tools`
    }
  });

  while (iteration < maxIterations) {
    iteration++;

    await emitTraceEvent(runId, "thinking", {
      content: `Iteration ${iteration}: Analyzing and planning next action...`,
      phase: "execution"
    });

    try {
      // Separate system messages from conversation, and build Gemini-compatible messages
      // Gemini requires alternating user/model roles — merge consecutive same-role messages
      let systemInstruction = "";
      const nonSystemMessages = conversationHistory.filter(m => {
        if (m.role === "system") {
          systemInstruction += (systemInstruction ? "\n\n" : "") + m.content;
          return false;
        }
        return true;
      });

      const geminiMessages: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      for (const m of nonSystemMessages) {
        const role = m.role === "assistant" ? "model" : "user";
        const last = geminiMessages[geminiMessages.length - 1];
        if (last && last.role === role) {
          // Merge into previous message to avoid consecutive same-role
          last.parts[0].text += "\n\n" + m.content;
        } else {
          geminiMessages.push({ role, parts: [{ text: m.content }] });
        }
      }

      // Ensure conversation starts with a user message (Gemini requirement)
      if (geminiMessages.length > 0 && geminiMessages[0].role !== "user") {
        geminiMessages.unshift({ role: "user", parts: [{ text: "Begin" }] });
      }

      // Wrap Gemini call with a 60s timeout to prevent hanging
      const geminiPromise = ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: geminiMessages as any,
        config: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          ...(systemInstruction ? { systemInstruction } : {}),
          tools: tools.length > 0 ? [{
            functionDeclarations: tools
          }] : undefined
        },
      } as any);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API call timed out after 60s")), 60000)
      );

      const response = await Promise.race([geminiPromise, timeoutPromise]);

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error("No response from model");
      }

      const parts = candidate.content?.parts || [];
      let hasToolCall = false;
      let textContent = "";
      let shouldExitAgentLoop = false;

      // Debug: log what the LLM returned
      const partTypes = parts.map((p: any) => p.functionCall ? `functionCall:${p.functionCall.name}` : p.text ? `text:${(p.text as string).slice(0, 80)}...` : 'other');
      console.log(`[AgentExecutor] Iteration ${iteration}: LLM returned ${parts.length} parts: [${partTypes.join(', ')}]`);

      for (const part of parts) {
        if (part.functionCall) {
          hasToolCall = true;
          const { name, args } = part.functionCall;

          writeSse(res, "tool_start", {
            runId,
            toolName: name!,
            args,
            iteration
          });

          const { result, artifact } = await executeToolCall(
            name!,
            args as Record<string, any>,
            toolContext,
            runId,
            res,
            reservationDetails
          );

          if (artifact) {
            artifacts.push(artifact);
          }

          writeSse(res, "tool_result", {
            runId,
            toolName: name,
            result,
            artifact,
            iteration
          });

          conversationHistory.push({
            role: "assistant",
            content: `[Called tool: ${name}]`
          });

          // Truncate large tool results (especially browse_and_act with 20+ steps)
          // to avoid overwhelming the LLM on the next iteration
          let resultSummary: string;
          if (name === "browse_and_act") {
            const r = result as any;
            resultSummary = JSON.stringify({
              success: r.success,
              stepsCount: r.stepsCount || r.steps?.length || 0,
              summary: r.data?.summary || r.data?.finalUrl || "Task completed",
              lastSteps: (r.steps || []).slice(-3).map((s: any) =>
                typeof s === 'string' ? s.slice(0, 100) : JSON.stringify(s).slice(0, 100)
              ),
            });
          } else {
            const raw = JSON.stringify(result);
            resultSummary = raw.length > 2000 ? raw.slice(0, 2000) + "... [truncated]" : raw;
          }

          conversationHistory.push({
            role: "user",
            content: `Tool result for ${name}: ${resultSummary}`
          });

          // FAST EXIT: After browse_and_act completes, generate an immediate
          // response instead of making another (slow/failing) LLM call.
          // The browser automation already took 2-10 minutes; the user doesn't
          // need to wait for another LLM round-trip just to get a summary.
          if (name === "browse_and_act") {
            const r = result as any;
            const wasSuccessful = r.success === true;
            const stepsCount = r.stepsCount || r.steps?.length || 0;
            const lastSteps = (r.steps || []).slice(-3).map((s: any) =>
              typeof s === 'string' ? s : (s?.action || s?.description || JSON.stringify(s).slice(0, 80))
            );
            const dataStatus = String(r?.data?.status || "").toLowerCase();
            const missingFields = Array.isArray(r?.data?.missingFields)
              ? (r.data.missingFields as string[])
              : [];
            const clarificationQuestion = typeof r?.data?.question === "string" ? r.data.question.trim() : "";
            const confirmationCode =
              r?.data?.confirmationCode ||
              r?.data?.reservationCode ||
              r?.data?.bookingReference ||
              r?.data?.confirmation;
            const isNeedsUserInput = dataStatus === "needs_user_input" || missingFields.length > 0;

            // Build rich summary with checklist for reservations
            // Note: use variables in executeAgentLoop scope (isReservationRequest, reservationDetails, res)
            // NOT the ones from executeToolCall scope (isReservationGoal, reservationDetailsFromGoal, sseRes, effectiveUrl)
            const finalUrl = r?.data?.finalUrl || r?.data?.url || "";
            const allSteps = (r.steps || []).map((s: any) =>
              typeof s === 'string' ? s : (s?.action || s?.description || JSON.stringify(s).slice(0, 80))
            );

            let summaryText: string;
            if (isNeedsUserInput) {
              summaryText = clarificationQuestion ||
                `Para continuar con la reserva necesito: ${missingFields.join(", ")}.`;
              writeSse(res, "clarification", {
                runId,
                question: summaryText,
                missingFields,
              });
            } else if (isReservationRequest) {
              // Rich reservation checklist summary
              const rd = reservationDetails;
              const checkItems: string[] = [];
              if (rd?.restaurant) checkItems.push(`- [x] **Restaurante:** ${rd.restaurant}`);
              if (rd?.date) checkItems.push(`- [x] **Fecha:** ${rd.date}`);
              if (rd?.time) checkItems.push(`- [x] **Hora:** ${rd.time}`);
              if (rd?.partySize) checkItems.push(`- [x] **Personas:** ${rd.partySize}`);
              if (rd?.contactName) checkItems.push(`- [x] **Nombre:** ${rd.contactName}`);
              if (rd?.phone) checkItems.push(`- [x] **Teléfono:** ${rd.phone}`);
              if (rd?.email) checkItems.push(`- [x] **Email:** ${rd.email}`);
              const checklistBlock = checkItems.length > 0
                ? `\n\n**Datos registrados:**\n${checkItems.join('\n')}`
                : "";
              const stepsBlock = allSteps.length > 0
                ? `\n\n**Acciones realizadas (${allSteps.length} pasos):**\n${allSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
                : "";
              const linkBlock = finalUrl ? `\n\n**Enlace de la reserva:** [${finalUrl}](${finalUrl})` : "";

              if (wasSuccessful && confirmationCode) {
                summaryText = `✅ **Reserva confirmada exitosamente**\n\n**Código de confirmación:** \`${confirmationCode}\`${checklistBlock}${stepsBlock}${linkBlock}`;
              } else if (wasSuccessful) {
                summaryText = `✅ **Reserva completada exitosamente**${checklistBlock}${stepsBlock}${linkBlock}`;
              } else {
                const reason = clarificationQuestion || r?.data?.reason || "";
                const reasonLine = reason ? `\n\n**Estado:** ${reason}` : "";
                summaryText = `⚠️ **Proceso de reserva finalizado** (${stepsCount} pasos)${reasonLine}${checklistBlock}${stepsBlock}${linkBlock}\n\nTe recomiendo verificar directamente en el enlace.`;
              }
            } else if (wasSuccessful && confirmationCode) {
              summaryText = `✅ **Tarea completada en la web**\n\nCódigo/confirmación: ${confirmationCode}\n\n**Acciones realizadas:**\n${allSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}${finalUrl ? `\n\n**Enlace:** [${finalUrl}](${finalUrl})` : ""}`;
            } else if (wasSuccessful) {
              summaryText = `✅ **Automatización web completada exitosamente**\n\nRealicé ${stepsCount} acciones en el navegador para completar tu solicitud.\n\n**Acciones realizadas:**\n${allSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}${finalUrl ? `\n\n**Enlace:** [${finalUrl}](${finalUrl})` : ""}`;
            } else {
              summaryText = `⚠️ **Automatización web finalizada** (${stepsCount} pasos)\n\nNavegué por el sitio web y realicé varias acciones, pero no pude confirmar que la tarea se completó al 100%.\n\n**Últimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join('\n')}${finalUrl ? `\n\n**Enlace:** [${finalUrl}](${finalUrl})` : ""}\n\nTe recomiendo verificar directamente en el sitio web.`;
            }

            fullResponse = summaryText;
            // Emit final browser_step "done" so VirtualComputer transitions to completed
            if (res) {
              try {
                const r2 = res as any;
                if (!r2.writableEnded && !r2.destroyed) {
                  res.write(`event: browser_step\ndata: ${JSON.stringify({
                    runId,
                    stepNumber: stepsCount + 1,
                    totalSteps: stepsCount + 1,
                    action: "done",
                    reasoning: wasSuccessful ? "Tarea completada" : "Proceso finalizado",
                    goalProgress: wasSuccessful ? "100%" : `${Math.min(95, Math.round((stepsCount / 15) * 100))}%`,
                    screenshot: "",
                    url: finalUrl,
                    title: "",
                  })}\n\n`);
                  if (typeof r2.flush === "function") r2.flush();
                }
              } catch {}
            }
            // Send the entire summary as a single chunk to preserve markdown formatting
            writeSse(res, "chunk", {
              content: summaryText,
              sequence: 1,
              runId
            });
            console.log(`[AgentExecutor] browse_and_act FAST EXIT: success=${wasSuccessful}, steps=${stepsCount}`);
            shouldExitAgentLoop = true;
            break;
          }
        } else if (part.text) {
          textContent += part.text;
        }
      }

      if (shouldExitAgentLoop) {
        break;
      }

      if (textContent) {
        fullResponse += textContent;

        if (!hasToolCall) {
          // For web_automation intent: if the LLM returned text instead of a tool call
          // AND we haven't already tried browse_and_act (iteration 1 = first attempt),
          // force it to use browse_and_act by injecting a strong nudge and retrying.
          // After the first browse_and_act attempt, allow text responses (result summaries).
          const alreadyUsedBrowser = conversationHistory.some(m =>
            m.content.includes("[Called tool: browse_and_act]")
          );
          if (requestSpec.intent === "web_automation" && iteration <= 2 && !alreadyUsedBrowser) {
            console.log(`[AgentExecutor] web_automation: LLM returned text instead of tool call on iteration ${iteration}, forcing tool use...`);
            conversationHistory.push({
              role: "assistant",
              content: textContent
            });
            conversationHistory.push({
              role: "user",
              content: `IMPORTANT: Do NOT respond with text. You MUST call the "browse_and_act" function right now to open a real browser and complete the task. Call browse_and_act with url="https://www.mesa247.pe" and goal containing all the details from the user's request. Do it NOW.`
            });
            textContent = "";
            fullResponse = "";
            continue; // retry the iteration
          }

          // A1: Agent Verifier - Quality Gate
          try {
            // Dynamic import to avoid circular dependencies if any, though explicit import is better. 
            // Since I can't add top-level imports easily with replace_file_content if I don't target the top, I'll use dynamic import or just hope for the best? 
            // Actually, I should use multi_replace to add the import.
            // But wait, I can use dynamic import here to be safe and localized.
            const { validateResponse } = await import("../services/responseValidator");
            const validation = validateResponse(textContent);

            if (!validation.isValid && iteration < maxIterations) {
              console.warn(`[AgentVerifier] Response rejected: ${validation.issues.map(i => i.message).join(", ")}`);

              await emitTraceEvent(runId, "verification_failed", {
                issues: validation.issues,
                rejectedContent: textContent.substring(0, 100) + "..."
              });

              conversationHistory.push({
                role: "assistant",
                content: textContent
              });
              conversationHistory.push({
                role: "user",
                content: `SYSTEM_ALERT: Your response was rejected by the Quality Verifier. 
Issues detected:
${validation.issues.map(i => `- ${i.message}`).join("\n")}

Please rewrite your response addressing these issues.`
              });

              // Skip streaming and continue to next iteration for retry
              continue;
            }
          } catch (err: any) {
            console.error("[AgentVerifier] Error during validation:", err);
            // Fail open: if verifier crashes, let the response through but log it
            await emitTraceEvent(runId, "verification_failed", {
              error: {
                message: `Verifier crashed: ${err.message}`,
                details: { stack: err.stack }
              },
              metadata: {
                checkName: "System Integrity",
                contentSnippet: textContent.substring(0, 50)
              }
            });
          }

          const chunks = textContent.match(/.{1,100}/g) || [textContent];
          for (let i = 0; i < chunks.length; i++) {
            writeSse(res, "chunk", {
              content: chunks[i],
              sequence: i + 1,
              runId
            });
            await new Promise(r => setTimeout(r, 10));
          }

          break;
        }
      }

      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: iteration,
          total: maxIterations,
          message: `Completed iteration ${iteration}`
        }
      });

    } catch (error: any) {
      console.error(`[AgentExecutor] Error in iteration ${iteration}:`, error?.message || error);

      await emitTraceEvent(runId, "error", {
        error: {
          code: "AGENT_EXECUTION_ERROR",
          message: error.message,
          retryable: iteration < maxIterations
        }
      });

      // If browse_and_act already ran successfully and the follow-up LLM call
      // failed (timeout, too-large context, etc.), generate a fallback summary
      // instead of retrying forever or crashing.
      const alreadyBrowsed = conversationHistory.some(m =>
        m.content.includes("[Called tool: browse_and_act]")
      );
      if (alreadyBrowsed && !fullResponse) {
        console.log(`[AgentExecutor] Post-browse LLM call failed, generating fallback summary`);
        // Extract browse result from conversation history
        const browseResultMsg = conversationHistory.find(m =>
          m.content.startsWith("Tool result for browse_and_act:")
        );
        const browseData = browseResultMsg?.content || "";
        const successMatch = browseData.match(/"success"\s*:\s*(true|false)/);
        const wasSuccessful = successMatch?.[1] === "true";

        const fallback = wasSuccessful
          ? "✅ He completado la automatización web exitosamente. El navegador realizó todas las acciones necesarias en el sitio web."
          : "⚠️ He intentado completar la tarea de automatización web. El navegador navegó por el sitio web y realizó varias acciones, pero no pude confirmar que la tarea se completó al 100%. Te recomiendo verificar directamente en el sitio.";

        fullResponse = fallback;
        const chunks = fallback.match(/.{1,100}/g) || [fallback];
        for (let i = 0; i < chunks.length; i++) {
          writeSse(res, "chunk", {
            content: chunks[i],
            sequence: i + 1,
            runId
          });
        }
        break; // Exit the while loop
      }

      if (iteration >= maxIterations) {
        throw error;
      }
    }
  }

  if (!fullResponse && iteration >= maxIterations) {
    const fallbackMsg = artifacts.length > 0
      ? `He completado las tareas solicitadas y generé ${artifacts.length} archivo(s) para ti.`
      : "He procesado tu solicitud. Avísame si necesitas algo más.";
    fullResponse = fallbackMsg;
    writeSse(res, "chunk", {
      content: fallbackMsg,
      sequence: 1,
      runId
    });
  }

  if (artifacts.length > 0) {
    writeSse(res, "artifacts", {
      runId,
      artifacts,
      count: artifacts.length
    });
  }

  await emitTraceEvent(runId, "agent_completed", {
    agent: {
      name: requestSpec.primaryAgent,
      role: "primary",
      status: "completed"
    },
    iterations: iteration,
    artifactsGenerated: artifacts.length
  });

  return fullResponse;
}

export { AGENT_TOOLS, getToolsForIntent };
