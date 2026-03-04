import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";
import { costEngine } from "../../../services/finops/costEngine";
import { AgentOS } from "../../index";
import { OnboardingAgent } from "../agents/onboarding_agent";
import { qos } from "./qos"; // Import QoS Engine

export const ProviderType = z.enum(["openai", "anthropic", "google", "xai", "openrouter", "ollama", "local", "gemini", "deepseek"]);
export type ProviderType = z.infer<typeof ProviderType>;

export const ModelRequest = z.object({
  provider: ProviderType.optional(),
  modelId: z.string().optional(),
  model: z.string().optional(),
  messages: z.array(z.any()),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().default(false),
  userId: z.string().default("anonymous"),
  requestId: z.string().optional(),
  budgetLimit: z.number().optional(),
});

export class ModelRouter {
  
  private isTrivialQuery(messages: any[]): string | null {
    const lastMsg = messages[messages.length - 1]?.content;
    if (typeof lastMsg !== 'string') return null;
    const clean = lastMsg.trim().toLowerCase();
    if (/^(hola|hello|hi|buenos d[ií]as|buenas tardes|qué tal|hey)$/.test(clean)) {
        return null; 
    }
    if (clean === "ping") return "pong";
    return null;
  }

  // Selección Inteligente (QoS + Cost)
  private async selectStrategy(req: any): Promise<{ model: string, fallback?: string, provider?: string }> {
    const requested = req.modelId || req.model;
    if (requested) return { model: requested };

    // 1. Determinar Tier (Complexity)
    // Heurística simple: long prompt = complex task
    const promptLen = JSON.stringify(req.messages).length;
    const isComplex = promptLen > 2000;

    const fastCandidates = ["xai", "google", "deepseek"]; // grok, gemini, deepseek
    const smartCandidates = ["anthropic", "openai"]; // claude, gpt-4o

    // 2. Consultar QoS
    const bestFastProvider = qos.getBestProvider(fastCandidates);
    const bestSmartProvider = qos.getBestProvider(smartCandidates);

    // 3. Mapear Provider a Modelo Concreto
    const mapModel = (prov: string | null, type: "fast" | "smart") => {
        if (!prov) return type === "fast" ? "grok-3-fast" : "gpt-4o";
        if (prov === "xai") return "grok-3-fast";
        if (prov === "google") return type === "fast" ? "gemini-2.0-flash" : "gemini-2.0-pro-exp";
        if (prov === "deepseek") return "deepseek-chat";
        if (prov === "anthropic") return "claude-3-5-sonnet-20241022";
        if (prov === "openai") return "gpt-4o";
        return "gpt-4o-mini";
    };

    if (isComplex) {
        return { 
            model: mapModel(bestSmartProvider, "smart"),
            fallback: mapModel(bestFastProvider, "fast") // Fallback to fast if smart fails
        };
    } else {
        return {
            model: mapModel(bestFastProvider, "fast"),
            fallback: "gpt-4o-mini"
        };
    }
  }

  private injectCapabilities(messages: any[]) {
    try {
        const os = AgentOS.getInstance();
        if (os.status === "ready") {
            const artifactPrompt = os.artifacts.getSystemPromptInjection();
            const sysMsg = messages.find(m => m.role === "system");
            if (sysMsg) {
                sysMsg.content += `\n${artifactPrompt}`;
            } else {
                messages.unshift({ role: "system", content: artifactPrompt });
            }
        }
    } catch (e) {}
    return messages;
  }

  // ── Sync Chat Routing ──
  async route(req: any): Promise<any> {
    const { userId, messages, temperature, maxTokens, requestId } = req;

    // #91 Onboarding Check
    if (messages.length === 1 && messages[0].role === "user") {
        const onboarding = new OnboardingAgent();
        const welcome = await onboarding.welcomeUser(userId);
        if (welcome) {
            return {
                id: requestId || `onboarding_${Date.now()}`,
                provider: "local",
                modelId: "onboarding-agent",
                output: welcome,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                latencyMs: 100
            };
        }
    }

    const trivialResponse = this.isTrivialQuery(messages);
    if (trivialResponse) {
        return {
            id: requestId || `local_${Date.now()}`,
            provider: "local",
            modelId: "trivial-detector",
            output: trivialResponse,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            latencyMs: 1
        };
    }

    try { await costEngine.enforceGuardrails(userId, 0); } catch (e) { throw new Error("Budget exceeded."); }

    const strategy = await this.selectStrategy(req);
    const enrichedMessages = this.injectCapabilities([...messages]);

    const start = Date.now();
    try {
        const res = await llmGateway.chat(enrichedMessages, {
            model: strategy.model,
            temperature,
            maxTokens,
            userId,
            requestId,
            enableFallback: false,
            _fromRouter: true
        });
        
        // Report success to QoS
        qos.recordSignal(res.provider, true, Date.now() - start);
        return res;

    } catch (error: any) {
        // Report failure
        // Try to infer provider from model name
        const failedProvider = strategy.model.includes("gpt") ? "openai" : strategy.model.includes("claude") ? "anthropic" : "google";
        qos.recordSignal(failedProvider, false, Date.now() - start);

        if (strategy.fallback) {
            console.warn(`[ModelRouter] ${strategy.model} failed, QoS triggering fallback to ${strategy.fallback}`);
            return await llmGateway.chat(enrichedMessages, {
                model: strategy.fallback,
                temperature,
                maxTokens,
                userId,
                requestId,
                enableFallback: true,
                _fromRouter: true
            });
        }
        throw error;
    }
  }

  // ── Streaming Chat Routing ──
  async * routeStream(req: any): AsyncGenerator<any, void, unknown> {
    const { userId, messages, temperature, maxTokens, requestId } = req;

    if (messages.length === 1 && messages[0].role === "user") {
        const onboarding = new OnboardingAgent();
        const welcome = await onboarding.welcomeUser(userId);
        if (welcome) {
            yield { content: welcome, done: false, sequenceId: 1, requestId };
            yield { content: "", done: true, sequenceId: 2, requestId };
            return;
        }
    }

    const trivialResponse = this.isTrivialQuery(messages);
    if (trivialResponse) {
        yield { content: trivialResponse, done: false, sequenceId: 1, requestId };
        yield { content: "", done: true, sequenceId: 2, requestId };
        return;
    }

    const strategy = await this.selectStrategy(req);
    const enrichedMessages = this.injectCapabilities([...messages]);

    try {
        const stream = llmGateway.streamChat(enrichedMessages, {
            model: strategy.model,
            temperature,
            maxTokens,
            userId,
            requestId,
            enableFallback: !!strategy.fallback,
            _fromRouter: true
        });

        for await (const chunk of stream) {
            yield chunk;
        }
        // TODO: QoS tracking for streams is harder (need to detect end/error in loop)
    } catch (error) {
        throw error;
    }
  }
}
