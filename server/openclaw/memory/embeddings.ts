// server/openclaw/memory/embeddings.ts
import type { EmbeddingProvider } from '../types';

export function sanitizeAndNormalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map(v => Number.isFinite(v) ? v : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map(v => v / magnitude);
}

export async function createEmbeddingProvider(opts: {
  provider: string;
  model: string;
  fallback?: string;
}): Promise<EmbeddingProvider | null> {
  const providers: Array<{ name: string; factory: () => Promise<EmbeddingProvider> }> = [];

  if (opts.provider === 'gemini' || opts.provider === 'auto') {
    providers.push({ name: 'gemini', factory: () => createGeminiEmbedder(opts.model) });
  }
  if (opts.provider === 'openai' || opts.provider === 'auto') {
    providers.push({ name: 'openai', factory: () => createOpenAIEmbedder(opts.model) });
  }
  if (opts.fallback && opts.fallback !== opts.provider) {
    providers.push({ name: opts.fallback, factory: () => createProviderByName(opts.fallback!, opts.model) });
  }

  for (const p of providers) {
    try {
      return await p.factory();
    } catch (err: any) {
      if (err.message?.includes('API key')) {
        console.warn(`Embedding provider ${p.name}: missing API key, trying next`);
        continue;
      }
      throw err;
    }
  }
  console.warn('No embedding provider available, falling back to FTS-only');
  return null;
}

async function createGeminiEmbedder(model: string): Promise<EmbeddingProvider> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY — API key required for Gemini embeddings');
  const { GoogleGenAI } = await import('@google/genai');
  const genai = new GoogleGenAI({ apiKey });
  const dimensions = model.includes('004') ? 768 : 256;

  return {
    dimensions,
    async embedQuery(text: string): Promise<number[]> {
      const result = await genai.models.embedContent({ model, contents: text });
      return sanitizeAndNormalizeEmbedding(result.embeddings?.[0]?.values ?? []);
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const results = await Promise.all(texts.map(t =>
        genai.models.embedContent({ model, contents: t }).then(r =>
          sanitizeAndNormalizeEmbedding(r.embeddings?.[0]?.values ?? [])
        )
      ));
      return results;
    },
  };
}

async function createOpenAIEmbedder(model: string): Promise<EmbeddingProvider> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY — API key required for OpenAI embeddings');
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  const dimensions = model.includes('large') ? 3072 : 1536;

  return {
    dimensions,
    async embedQuery(text: string): Promise<number[]> {
      const res = await client.embeddings.create({ model: model || 'text-embedding-3-small', input: text });
      return sanitizeAndNormalizeEmbedding(res.data[0].embedding);
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const res = await client.embeddings.create({ model: model || 'text-embedding-3-small', input: texts });
      return res.data.map(d => sanitizeAndNormalizeEmbedding(d.embedding));
    },
  };
}

async function createProviderByName(name: string, model: string): Promise<EmbeddingProvider> {
  switch (name) {
    case 'gemini': return createGeminiEmbedder(model);
    case 'openai': return createOpenAIEmbedder(model);
    default: throw new Error(`Unknown embedding provider: ${name}`);
  }
}
