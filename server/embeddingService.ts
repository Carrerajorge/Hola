import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

export interface TextChunk {
  content: string;
  chunkIndex: number;
  pageNumber?: number;
}

export function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): TextChunk[] {
  const chunks: TextChunk[] = [];
  const cleanedText = text.replace(/\s+/g, " ").trim();
  
  if (cleanedText.length <= chunkSize) {
    return [{ content: cleanedText, chunkIndex: 0 }];
  }

  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanedText.length) {
    let endIndex = Math.min(startIndex + chunkSize, cleanedText.length);
    
    if (endIndex < cleanedText.length) {
      const lastSpace = cleanedText.lastIndexOf(" ", endIndex);
      if (lastSpace > startIndex) {
        endIndex = lastSpace;
      }
    }

    const chunkContent = cleanedText.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        content: chunkContent,
        chunkIndex,
      });
      chunkIndex++;
    }

    startIndex = endIndex - overlap;
    if (startIndex >= cleanedText.length) break;
    if (endIndex >= cleanedText.length) break;
  }

  return chunks;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Embedding generation error:", error);
    return new Array(1536).fill(0);
  }
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const BATCH_SIZE = 20;
  const allEmbeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.slice(0, 8000));
    
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch,
      });
      
      const batchEmbeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding);
      
      allEmbeddings.push(...batchEmbeddings);
    } catch (error) {
      console.error("Batch embedding error:", error);
      for (let j = 0; j < batch.length; j++) {
        allEmbeddings.push(new Array(1536).fill(0));
      }
    }
  }
  
  return allEmbeddings;
}
