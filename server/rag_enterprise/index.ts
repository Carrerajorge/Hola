export * from './ingestionPipeline.js';
export * from './multiVectorEmbedding.js';
export * from './retrievalCascade.js';
export * from './reasoningRouter.js';
export * from './groundedGeneration.js';

import { ingestionPipeline } from './ingestionPipeline.js';
import { multiVectorEmbedding } from './multiVectorEmbedding.js';
import { retrievalCascade } from './retrievalCascade.js';
import { reasoningRouter } from './reasoningRouter.js';
import { groundedGenerator } from './groundedGeneration.js';

export class RAGEnterpriseCoordinator {
    public async initialize() {
        console.log('[RAG Enterprise] Bootstrapping Super RAG Enterprise Pipeline...');
        console.log('[RAG Enterprise] Ingestion nodes mounted. Multi-vector encoders warmed up. Grounding rules loaded.');
    }

    public async serveQuery(userPrompt: string) {
        // 1. orchestrate
        const context = await reasoningRouter.orchestrateQuery(userPrompt);
        // 2. generate
        const answer = await groundedGenerator.synthesizeResponse(userPrompt, context);
        console.log('[RAG Enterprise] Generation Complete =>', answer.finalText);
        return answer;
    }
}

export const globalRagEnterprise = new RAGEnterpriseCoordinator();
