import { randomUUID } from 'crypto';

export interface RawDocument {
    id: string;
    sourceUri: string;
    content: string;
    metadata: Record<string, any>;
}

export interface ChunkNode {
    id: string;
    parentId: string | null;
    documentId: string;
    text: string;
    level: 'document' | 'section' | 'paragraph' | 'sentence';
    nlpEntities: string[];
}

export class IngestionPipeline {
    constructor() { }

    public async processDocument(doc: RawDocument): Promise<ChunkNode[]> {
        console.log(`[IngestionPipeline] Processing document: ${doc.sourceUri}`);

        // 1. Deduplication & Cleaning (Mock)
        const cleanText = this.cleanText(doc.content);

        // 2. Hierarchical Chunking (Mock)
        const chunks = this.hierarchicalChunk(doc.id, cleanText);

        // 3. NLP Enrichment (Mock NER)
        for (const chunk of chunks) {
            chunk.nlpEntities = this.extractEntities(chunk.text);
        }

        console.log(`[IngestionPipeline] Document yielded ${chunks.length} hierarchical chunks.`);
        return chunks;
    }

    private cleanText(raw: string): string {
        return raw.replace(/<[^>]*>?/gm, '').trim(); // Strip HTML, trim
    }

    private hierarchicalChunk(docId: string, text: string): ChunkNode[] {
        // Generate a mock hierarchy
        const docNode: ChunkNode = { id: randomUUID(), parentId: null, documentId: docId, text: text.substring(0, 500) + '...', level: 'document', nlpEntities: [] };
        const sectionNode: ChunkNode = { id: randomUUID(), parentId: docNode.id, documentId: docId, text: text.substring(0, 200), level: 'section', nlpEntities: [] };
        const paragraphNode: ChunkNode = { id: randomUUID(), parentId: sectionNode.id, documentId: docId, text: text.substring(0, 100), level: 'paragraph', nlpEntities: [] };

        return [docNode, sectionNode, paragraphNode];
    }

    private extractEntities(text: string): string[] {
        return text.includes('Tenaga') ? ['Tenaga (System)'] : ['Generic Entity'];
    }
}

export const ingestionPipeline = new IngestionPipeline();
