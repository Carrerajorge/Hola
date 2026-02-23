import { AgentGoal } from "./autonomousAgentBrain";
import { UnifiedUIState } from "../vision/accessibilityFusion";
import OpenAI from "openai";

const aiClient = new OpenAI({
    apiKey: process.env.XAI_API_KEY || "missing",
    baseURL: "https://api.x.ai/v1",
});

export interface PolicyAction {
    description: string;
    tool: string;
    params: any;
}

export interface Policy {
    actions: PolicyAction[];
    expectedFreeEnergy: number; // Menor es mejor
}

export class BeliefState {
    constructor(public uiState: UnifiedUIState) { }

    update(obs: UnifiedUIState, action: PolicyAction, postObs: UnifiedUIState) {
        this.uiState = postObs;
    }
}

export class MCTSNode {
    children: MCTSNode[] = [];
    visits: number = 0;
    value: number = 0; // Value aquí representa reducción de sorpresa a largo plazo

    constructor(public state: BeliefState, public observation: UnifiedUIState, public action?: PolicyAction) { }

    isTerminal(): boolean {
        // TODO: check if goal state achieved in simulation
        return false;
    }

    isFullyExpanded(): boolean {
        return this.children.length > 0;
    }

    selectChild(): MCTSNode {
        // UCB1 formula: value/visits + C * sqrt(ln(parent.visits) / node.visits)
        return this.children.reduce((best, child) => {
            const ucb1 = (child.value / (child.visits || 1)) + 1.41 * Math.sqrt(Math.log(this.visits) / (child.visits || 1));
            const bestUcb1 = (best.value / (best.visits || 1)) + 1.41 * Math.sqrt(Math.log(this.visits) / (best.visits || 1));
            return ucb1 > bestUcb1 ? child : best;
        }, this.children[0] || this);
    }

    expand(action: PolicyAction): MCTSNode {
        const child = new MCTSNode(this.state, this.observation, action);
        this.children.push(child);
        return child;
    }

    backpropagate(reward: number) {
        this.visits++;
        this.value += reward;
    }

    getBestPolicies(limit: number): Policy[] {
        return this.children
            .sort((a, b) => b.value - a.value)
            .slice(0, limit)
            .map(c => ({
                actions: c.action ? [c.action] : [],
                expectedFreeEnergy: 1 - (c.value / (c.visits || 1)) // Inverso del reward
            }));
    }
}

export class PolicyTree {
    async generatePolicies(
        belief: BeliefState,
        observation: UnifiedUIState,
        goal: AgentGoal,
        opts: { maxDepth: number; branchFactor: number }
    ): Promise<Policy[]> {
        const root = new MCTSNode(belief, observation);

        // Limitado iterativamente
        for (let sim = 0; sim < 10; sim++) {
            let node = root;

            while (node.isFullyExpanded() && !node.isTerminal()) {
                node = node.selectChild();
            }

            if (!node.isTerminal()) {
                // Real MCTS Expansion powered by LLM heuristics
                const nextActions = await this.predictViableActions(node.observation, goal, opts.branchFactor);
                if (nextActions.length > 0) {
                    for (const action of nextActions) {
                        node.expand(action);
                    }
                    if (node.children.length > 0) {
                        node = node.children[0];
                    }
                }
            }

            const reward = await this.simulate(node, goal, opts.maxDepth);
            node.backpropagate(reward);
        }

        return root.getBestPolicies(5);
    }

    private async predictViableActions(obs: UnifiedUIState, goal: AgentGoal, branchFactor: number): Promise<PolicyAction[]> {
        if (!obs || !obs.semanticState) return [];

        const prompt = `
Dadas las siguientes precondiciones:
META: "${goal.description}"
ESTADO ACTUAL UI: "${obs.semanticState}"

Genera una lista estricta JSON de hasta ${branchFactor} acciones posibles a explorar.
Formato:
[{"tool": "nombre", "params": {}, "description": "explicacion"}]
`;
        try {
            const response = await aiClient.chat.completions.create({
                model: "grok-2-1212",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3
            });
            let contentStr = response.choices[0]?.message?.content || "[]";
            if (contentStr.startsWith('\`\`\`json')) contentStr = contentStr.replace(/\`\`\`json\n?/, '').replace(/\`\`\`\n?$/, '');
            else if (contentStr.startsWith('\`\`\`')) contentStr = contentStr.replace(/\`\`\`\n?/, '').replace(/\`\`\`\n?$/, '');

            return JSON.parse(contentStr.trim()) as PolicyAction[];
        } catch (e) {
            console.error("[PolicyTree] MCTS Action Prediction Error:", e);
            return [];
        }
    }

    private async simulate(node: MCTSNode, goal: AgentGoal, maxDepth: number): Promise<number> {
        // Rollout real via VLM / LLM: "si ejecuto [acción] en [estado actual], ¿qué pasará?"
        if (!node.observation || !node.observation.semanticState) return 0.0;

        const currentState = node.observation.semanticState;
        if (currentState.toUpperCase().includes('ERROR')) return 0.0; // Fail-fast

        const actionDesc = node.action ? `${node.action.tool}(${JSON.stringify(node.action.params)})` : "Ninguna (Observación inicial)";

        try {
            const prompt = `
ERES EL EVALUADOR DE UN ÁRBOL MCTS (Monte Carlo Tree Search).
OBJETIVO DEL AGENTE: "${goal.description}"
ESTADO ACTUAL (Semántico de la UI): "${currentState}"
ACCIÓN A EJECUTAR: "${actionDesc}"

Predice si esta acción acercará al agente al objetivo.
Tu única respuesta debe ser un número decimal entre 0.0 y 1.0, donde 1.0 es "éxito absoluto" y 0.0 es "fallo total".
No digas NADA MÁS que el número.`;

            const response = await aiClient.chat.completions.create({
                model: "grok-2-1212",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 5
            });

            const scoreText = response.choices[0]?.message?.content?.trim() || "0.0";
            const score = parseFloat(scoreText);

            return isNaN(score) ? 0.0 : Math.max(0.0, Math.min(1.0, score));
        } catch (error) {
            console.error("[PolicyTree] MCTS LLM Simulation Error:", error);
            return 0.1; // Exploración base en caso de fallo del API
        }
    }
}
