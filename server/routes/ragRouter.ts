import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ragPipeline } from '../services/ragPipeline';
import { visualRetrieval } from '../services/visualRetrieval';
import { db } from '../db';
import { files, fileChunks } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { streamChat } from '../services/chatService';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/index', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const result = await ragPipeline.indexDocument(
      fileId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    res.json({
      success: true,
      fileId,
      fileName: req.file.originalname,
      ...result
    });
  } catch (error) {
    console.error('[RAG Router] Index error:', error);
    res.status(500).json({ 
      error: 'Failed to index document',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/query', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, topK = 5, language = 'es' } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const result = await ragPipeline.answerWithRAG(query, fileIds, {
      topK,
      language
    });

    res.json({
      success: true,
      query,
      context: {
        chunksRetrieved: result.context.chunks.length,
        totalChunks: result.context.totalChunks,
        processingTimeMs: result.context.processingTimeMs
      },
      chunks: result.context.chunks,
      citations: result.citations,
      tables: result.tables,
      prompt: result.prompt
    });
  } catch (error) {
    console.error('[RAG Router] Query error:', error);
    res.status(500).json({ 
      error: 'Failed to query documents',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/answer', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, topK = 5, language = 'es', stream = false } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const ragResult = await ragPipeline.answerWithRAG(query, fileIds, {
      topK,
      language
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      res.write(`data: ${JSON.stringify({ 
        type: 'context',
        citations: ragResult.citations,
        tables: ragResult.tables,
        chunksRetrieved: ragResult.context.chunks.length
      })}\n\n`);

      try {
        const { GoogleGenAI } = await import('@google/genai');
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        
        if (!apiKey) {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'No API key configured' 
          })}\n\n`);
          res.end();
          return;
        }

        const genAI = new GoogleGenAI({ apiKey });
        const result = await genAI.models.generateContentStream({
          model: 'gemini-2.0-flash',
          contents: ragResult.prompt
        });

        for await (const chunk of result) {
          const text = chunk.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
          }
        }

        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      } catch (streamError) {
        console.error('[RAG Router] Stream error:', streamError);
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: streamError instanceof Error ? streamError.message : 'Stream error' 
        })}\n\n`);
        res.end();
      }
    } else {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        
        if (!apiKey) {
          return res.status(500).json({ error: 'No API key configured' });
        }

        const genAI = new GoogleGenAI({ apiKey });
        const result = await genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: ragResult.prompt
        });

        const answer = result.text || '';

        res.json({
          success: true,
          query,
          answer,
          citations: ragResult.citations,
          tables: ragResult.tables,
          context: {
            chunksRetrieved: ragResult.context.chunks.length,
            totalChunks: ragResult.context.totalChunks,
            processingTimeMs: ragResult.context.processingTimeMs
          }
        });
      } catch (llmError) {
        console.error('[RAG Router] LLM error:', llmError);
        res.status(500).json({ 
          error: 'Failed to generate answer',
          details: llmError instanceof Error ? llmError.message : 'Unknown error'
        });
      }
    }
  } catch (error) {
    console.error('[RAG Router] Answer error:', error);
    res.status(500).json({ 
      error: 'Failed to answer query',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/chunks/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 20;
    const offset = (pageNum - 1) * limitNum;

    const chunks = await db
      .select()
      .from(fileChunks)
      .where(eq(fileChunks.fileId, fileId))
      .orderBy(fileChunks.chunkIndex)
      .limit(limitNum)
      .offset(offset);

    const totalResult = await db
      .select({ count: fileChunks.id })
      .from(fileChunks)
      .where(eq(fileChunks.fileId, fileId));

    res.json({
      success: true,
      fileId,
      chunks: chunks.map(c => ({
        id: c.id,
        content: c.content,
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        metadata: c.metadata,
        hasEmbedding: !!c.embedding
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalResult.length,
        hasMore: offset + chunks.length < totalResult.length
      }
    });
  } catch (error) {
    console.error('[RAG Router] Get chunks error:', error);
    res.status(500).json({ 
      error: 'Failed to get chunks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.delete('/chunks/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;

    await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));

    res.json({
      success: true,
      message: `Deleted all chunks for file ${fileId}`
    });
  } catch (error) {
    console.error('[RAG Router] Delete chunks error:', error);
    res.status(500).json({ 
      error: 'Failed to delete chunks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/semantic-search', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, topK = 10, minScore = 0.1 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const context = await ragPipeline.hybridRetrieve(query, fileIds, {
      topK,
      minScore
    });

    res.json({
      success: true,
      query,
      results: context.chunks,
      totalChunks: context.totalChunks,
      processingTimeMs: context.processingTimeMs
    });
  } catch (error) {
    console.error('[RAG Router] Semantic search error:', error);
    res.status(500).json({ 
      error: 'Failed to perform semantic search',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/analyze-image', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { context, query } = req.body;

    const analysis = await visualRetrieval.analyzeImageWithVision(
      req.file.buffer,
      req.file.mimetype,
      context
    );

    let chartData = null;
    if (analysis.elements.some(e => ['chart', 'graph'].includes(e.type))) {
      chartData = await visualRetrieval.extractChartData(
        req.file.buffer,
        req.file.mimetype
      );
    }

    let ragDescription = null;
    if (query) {
      ragDescription = await visualRetrieval.describeVisualForRAG(
        req.file.buffer,
        req.file.mimetype,
        query
      );
    }

    res.json({
      success: true,
      analysis,
      chartData,
      ragDescription,
      fileName: req.file.originalname
    });
  } catch (error) {
    console.error('[RAG Router] Analyze image error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/reindex-all', async (req: Request, res: Response) => {
  try {
    const { fileIds } = req.body;

    if (!fileIds || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const results: Array<{ fileId: string; success: boolean; error?: string }> = [];

    for (const fileId of fileIds) {
      try {
        const file = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
        if (file.length === 0) {
          results.push({ fileId, success: false, error: 'File not found' });
          continue;
        }

        results.push({ fileId, success: true });
      } catch (err) {
        results.push({ 
          fileId, 
          success: false, 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
      }
    }

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[RAG Router] Reindex error:', error);
    res.status(500).json({ 
      error: 'Failed to reindex files',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
