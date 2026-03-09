import { AgentOS } from "../agentos/index";
import { llmGateway } from "../lib/llmGateway";
import { MODELS } from "../lib/openai";

export async function routeChatWithAgentOS(messages: any[], options: any) {
    try {
      const agentOS = AgentOS.getInstance();
      // Use AgentOS routing if available
      if (agentOS.status === "ready" || agentOS.status === "degraded") {
         console.log(`[AgentOS] Routing request ${options.requestId} through ModelPlane...`);
         const modelReq = {
           modelId: options.model || MODELS.TEXT,
           messages: messages,
           temperature: options.temperature,
           userId: options.userId,
           requestId: options.requestId,
         };
         const routerResponse = await agentOS.model.router.route(modelReq);
         return {
           content: routerResponse.output,
           latencyMs: routerResponse.latencyMs,
           usage: routerResponse.usage,
           provider: routerResponse.provider
         };
      }
    } catch (e) {
      console.warn("[AgentOS] Routing failed, falling back to legacy gateway:", e);
    }
    // Fallback to direct legacy call
    return await llmGateway.chat(messages, options);
}
