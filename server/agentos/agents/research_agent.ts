import { AgentOS } from "../index";
import { llmGateway } from "../../lib/llmGateway";

interface ResearchParams {
  topic: string;
  depth: "quick" | "deep" | "comprehensive";
  format: "report" | "paper" | "brief";
}

export class ResearchAgent {
  private os: AgentOS;

  constructor() {
    this.os = AgentOS.getInstance();
  }

  async conductResearch(userId: string, params: ResearchParams) {
    console.log(`[ResearchAgent] 🔬 Starting ${params.depth} research on: "${params.topic}"`);

    // 1. Planificación de Búsqueda
    const plan = await this.createResearchPlan(params.topic);
    console.log(`[ResearchAgent] 📋 Plan generated: ${plan.queries.length} queries.`);

    const evidence = [];

    // 2. Ejecución de Búsqueda (Paralela)
    for (const query of plan.queries) {
        // Usar herramienta de búsqueda web (Action Plane)
        // Nota: Asumimos que 'web_search' existe en ActionPlane o usamos el wrapper
        // Aquí simulamos la llamada a través del ActionPlane si existiera, o usamos una tool directa.
        // Dado que web_search es legacy, usaremos web_deep_crawl si encontramos URLs prometedoras.
        
        // Fase 1: Búsqueda superficial para encontrar fuentes
        // Mock de resultados de búsqueda
        const sources = [
            `https://en.wikipedia.org/wiki/${params.topic.replace(/ /g, '_')}`,
            `https://scholar.google.com/scholar?q=${params.topic}`
        ];

        // Fase 2: Deep Crawl de fuentes
        for (const url of sources) {
            try {
                const content = await this.os.action.execute("web_deep_crawl", { url, maxDepth: 1 }, { userId });
                if (content.status === "success") {
                    evidence.push({ source: url, data: content.data });
                }
            } catch (e) {
                console.warn(`[ResearchAgent] Failed to crawl ${url}:`, e);
            }
        }
    }

    // 3. Síntesis y Citación
    const report = await this.synthesizeReport(params.topic, evidence, params.format);
    
    // 4. Guardar en Memoria (Knowledge Plane)
    await this.os.knowledge.memorize(userId, `Research Report: ${params.topic}\n\n${report}`, { type: "note", role: "assistant" });

    return report;
  }

  private async createResearchPlan(topic: string): Promise<{ queries: string[] }> {
    const response = await llmGateway.chat([
        { role: "system", content: "You are a Senior Researcher. Generate 3-5 search queries to cover this topic comprehensively. Output JSON: { \"queries\": [...] }" },
        { role: "user", content: topic }
    ], { model: "gpt-4o", _fromRouter: true });
    
    try {
        const clean = (response.content || "").replace(/```json|```/g, "").trim();
        return JSON.parse(clean);
    } catch {
        return { queries: [topic, `${topic} analysis`, `${topic} statistics`] };
    }
  }

  private async synthesizeReport(topic: string, evidence: any[], format: string): Promise<string> {
    const context = JSON.stringify(evidence).slice(0, 50000); // Truncate fit context
    
    const response = await llmGateway.chat([
        { role: "system", content: `You are a Scientific Writer. Write a ${format} about "${topic}". Use APA citations based on the provided evidence JSON. Be rigorous and objective.` },
        { role: "user", content: `Evidence:\n${context}` }
    ], { model: "claude-3-5-sonnet", _fromRouter: true }); // Sonnet is better for writing

    return response.content || "Failed to generate report.";
  }
}
