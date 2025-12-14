import OpenAI from "openai";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

export type RouteDecision = "llm" | "agent" | "hybrid";

export interface RouteResult {
  decision: RouteDecision;
  confidence: number;
  urls: string[];
  objective?: string;
  reasoning: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const DOMAIN_REGEX = /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})/gi;

const WEB_ACTION_KEYWORDS = [
  "busca", "buscar", "search", "find", "encuentra",
  "navega", "navigate", "go to", "ir a", "abre", "open",
  "extrae", "extract", "scrape", "obtén", "get",
  "lee", "read", "muéstrame", "show me",
  "descarga", "download", "investiga", "research",
  "compara", "compare", "analiza", "analyze",
  "visita", "visit", "revisa", "check", "consulta"
];

const CONTENT_CREATION_KEYWORDS = [
  "escribe", "write", "crea", "create", "genera", "generate",
  "redacta", "compose", "haz", "make", "diseña", "design"
];

export function extractUrls(text: string): string[] {
  const urls: string[] = [];
  const urlMatches = text.match(URL_REGEX);
  if (urlMatches) {
    urls.push(...urlMatches);
  }
  return Array.from(new Set(urls));
}

export function hasWebActionIntent(text: string): boolean {
  const lowerText = text.toLowerCase();
  return WEB_ACTION_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

export function hasContentCreationIntent(text: string): boolean {
  const lowerText = text.toLowerCase();
  return CONTENT_CREATION_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

export async function routeMessage(message: string): Promise<RouteResult> {
  const urls = extractUrls(message);
  const hasUrls = urls.length > 0;
  const hasWebIntent = hasWebActionIntent(message);
  const hasContentIntent = hasContentCreationIntent(message);

  if (!hasUrls && !hasWebIntent) {
    return {
      decision: "llm",
      confidence: 0.9,
      urls: [],
      reasoning: "No URLs or web action intent detected"
    };
  }

  if (hasUrls && !hasContentIntent) {
    return {
      decision: "agent",
      confidence: 0.85,
      urls,
      objective: `Navigate and extract information from: ${urls.join(", ")}`,
      reasoning: "URLs detected with extraction intent"
    };
  }

  if (hasWebIntent && !hasUrls) {
    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: `You are a routing classifier. Analyze the user's message and determine if it requires web browsing/navigation to complete.
            
Respond with JSON only:
{
  "requires_web": boolean,
  "confidence": number (0-1),
  "search_query": string or null (if web search needed),
  "reasoning": string
}`
          },
          { role: "user", content: message }
        ],
        temperature: 0.1
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));

      if (parsed.requires_web && parsed.confidence > 0.7) {
        return {
          decision: "agent",
          confidence: parsed.confidence,
          urls: [],
          objective: parsed.search_query || message,
          reasoning: parsed.reasoning
        };
      }
    } catch (e) {
      console.error("Router LLM error:", e);
    }
  }

  if (hasUrls && hasContentIntent) {
    return {
      decision: "hybrid",
      confidence: 0.8,
      urls,
      objective: `Extract from ${urls.join(", ")} and create content`,
      reasoning: "URLs detected with content creation intent - needs extraction then generation"
    };
  }

  return {
    decision: "llm",
    confidence: 0.7,
    urls,
    reasoning: "Defaulting to LLM response"
  };
}
