import { retrievalCascade, RetrievalQuery, ScoredResult } from './retrievalCascade.js';

export class MultiHopReasoningRouter {
    constructor() { }

    public async orchestrateQuery(rawQuery: string): Promise<ScoredResult[]> {
        console.log(`[ReasoningRouter] Processing query: "${rawQuery}" via multi-hop evaluation.`);

        // 1. Step-back prompting / Decompose query (Mock LLM invocation)
        const subQueries = this.decomposeQuery(rawQuery);
        console.log(`[ReasoningRouter] Query decomposed into ${subQueries.length} sub-queries.`);

        // 2. Parallel multi-vector retrieval for each sub-query
        const retrievalPromises = subQueries.map(async sub => {
            const query: RetrievalQuery = {
                rawCommand: sub,
                denseVector: new Array(1024).fill(0).map(() => Math.random()),
                sparseVector: { 0: 1 },
                topK: 5
            };
            return await retrievalCascade.retrieve(query);
        });

        const allResults = await Promise.all(retrievalPromises);

        // 3. Flatten and Deduplicate
        const flatResults = allResults.flat();
        const dedupedResults = this.deduplicateByContent(flatResults);

        console.log(`[ReasoningRouter] Final resolved context size: ${dedupedResults.length} unique chunks.`);
        return dedupedResults;
    }

    private decomposeQuery(query: string): string[] {
        // Basic mock of LLM deciding it needs to know part A and part B
        if (query.includes('compare')) {
            return [`What is A in ${query}?`, `What is B in ${query}?`];
        }
        return [query];
    }

    private deduplicateByContent(results: ScoredResult[]): ScoredResult[] {
        const seen = new Set<string>();
        const out: ScoredResult[] = [];
        for (const r of results) {
            if (!seen.has(r.chunk.id)) {
                seen.add(r.chunk.id);
                out.push(r);
            }
        }
        return out;
    }
}

export const reasoningRouter = new MultiHopReasoningRouter();
