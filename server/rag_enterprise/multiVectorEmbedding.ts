export interface VectorSet {
    dense: number[]; // e.g. BGE-M3 (1024 dims)
    sparse: Record<number, number>; // e.g. SPLADE or BM25 tokens
    clip?: number[]; // Vision features if multi-modal
    colbert?: number[][]; // Token-level embeddings (Late Interaction)
}

export class MultiVectorEmbedding {
    constructor() { }

    public async embedChunk(text: string, isImage: boolean = false): Promise<VectorSet> {
        // Simulate latency of calling multiple embedding models simultaneously
        await new Promise(r => setTimeout(r, 80));

        return {
            dense: new Array(1024).fill(0).map(() => Math.random() - 0.5),
            sparse: { [Math.floor(Math.random() * 30000)]: Math.random() }, // mock sparse vector
            colbert: [
                new Array(128).fill(0).map(() => Math.random()),
                new Array(128).fill(0).map(() => Math.random())
            ], // 2 tokens mock
            clip: isImage ? new Array(768).fill(0).map(() => Math.random()) : undefined
        };
    }
}

export const multiVectorEmbedding = new MultiVectorEmbedding();
