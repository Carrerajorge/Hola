/**
 * ILIAGPT × OpenClaw Fusion — OpenClaw Bridge Index
 * 
 * Main entry point for the OpenClaw Bridge module.
 * Integrates OpenClaw's agentic pipeline capabilities with ILIAGPT's
 * Express backend, providing unified routing and request handling.
 * 
 * @version 2.2.0-fusion
 * @license MIT
 */

import { Router, Request, Response, NextFunction } from 'express';
import { orchestrator } from '../agent/multiModelOrchestrator';
import { skillsRegistry } from './skillsRegistry';
import { OPENCLAW_CONFIG, FEATURE_FLAGS } from '../openclaw.config';
import { storage } from '../storage';
import { log } from '../vite';

/* ──────────────────────────────────────────────────
   Bridge Router Setup
   ────────────────────────────────────────────────── */

const router = Router();

/* ──────────────────────────────────────────────────
   Type Definitions
   ────────────────────────────────────────────────── */

interface BridgeRequest {
  message: string;
  taskType?: 'chat' | 'research' | 'code' | 'analysis' | 'vision' | 'quick';
  context?: string;
  sessionId?: number;
  userId?: number;
  stream?: boolean;
  maxCost?: number;
  preferredModel?: string;
  skillId?: string;
  metadata?: Record<string, unknown>;
}

interface BridgeResponse {
  success: boolean;
  content?: string;
  taskId?: string;
  modelUsed?: string;
  tokensUsed?: { input: number; output: number };
  costUSD?: number;
  latencyMs?: number;
  skillUsed?: string;
  error?: string;
}

/* ──────────────────────────────────────────────────
   Middleware
   ────────────────────────────────────────────────── */

function validateBridgeRequest(req: Request, res: Response, next: NextFunction) {
  const body = req.body as BridgeRequest;

  if (!body.message || typeof body.message !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'message field is required and must be a string',
    });
  }

  if (body.message.length > 100000) {
    return res.status(400).json({
      success: false,
      error: 'message exceeds maximum length of 100,000 characters',
    });
  }

  next();
}

/* ──────────────────────────────────────────────────
   Routes
   ────────────────────────────────────────────────── */

/**
 * POST /api/openclaw/execute
 * Execute a task through the OpenClaw bridge
 */
router.post('/execute', validateBridgeRequest, async (req: Request, res: Response) => {
  const body = req.body as BridgeRequest;
  const taskId = `bridge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    log(`OpenClaw bridge executing task ${taskId}`, 'bridge');

    // Check if a specific skill is requested
    if (body.skillId && FEATURE_FLAGS.ENABLE_6_STAGE_PIPELINE) {
      const skill = skillsRegistry.getSkill(body.skillId);
      if (skill) {
        const skillResult = await skillsRegistry.executeSkill(body.skillId, {
          message: body.message,
          context: body.context,
          metadata: body.metadata,
        });

        return res.json({
          success: true,
          content: skillResult.output,
          taskId,
          skillUsed: body.skillId,
          costUSD: skillResult.costUSD,
          latencyMs: skillResult.latencyMs,
        } as BridgeResponse);
      }
    }

    // Route through orchestrator
    const result = await orchestrator.executeTask({
      id: taskId,
      type: body.taskType || 'chat',
      prompt: body.message,
      context: body.context,
      sessionId: body.sessionId,
      userId: body.userId,
      maxCost: body.maxCost,
      preferredModel: body.preferredModel,
      metadata: body.metadata,
    });

    return res.json({
      success: true,
      content: result.content,
      taskId: result.taskId,
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,
      costUSD: result.costUSD,
      latencyMs: result.latencyMs,
    } as BridgeResponse);

  } catch (error) {
    log(`OpenClaw bridge error: ${error}`, 'bridge');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      taskId,
    } as BridgeResponse);
  }
});

/**
 * POST /api/openclaw/stream
 * Stream a task response through the OpenClaw bridge
 */
router.post('/stream', validateBridgeRequest, async (req: Request, res: Response) => {
  const body = req.body as BridgeRequest;
  const taskId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    log(`OpenClaw bridge streaming task ${taskId}`, 'bridge');

    await orchestrator.streamTask(
      {
        id: taskId,
        type: body.taskType || 'chat',
        prompt: body.message,
        context: body.context,
        sessionId: body.sessionId,
        userId: body.userId,
        maxCost: body.maxCost,
        preferredModel: body.preferredModel,
      },
      (chunk: string) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      },
      (result) => {
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          taskId: result.taskId,
          modelUsed: result.modelUsed,
          tokensUsed: result.tokensUsed,
          costUSD: result.costUSD,
          latencyMs: result.latencyMs,
        })}\n\n`);
        res.end();
      }
    );

  } catch (error) {
    log(`OpenClaw stream error: ${error}`, 'bridge');
    res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/openclaw/skills
 * List available skills
 */
router.get('/skills', (_req: Request, res: Response) => {
  const skills = skillsRegistry.listSkills();
  return res.json({
    success: true,
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      enabled: s.enabled,
    })),
  });
});

/**
 * GET /api/openclaw/status
 * Get bridge status and configuration
 */
router.get('/status', (_req: Request, res: Response) => {
  const costReport = orchestrator.getCostReport();
  return res.json({
    success: true,
    version: OPENCLAW_CONFIG.version,
    buildDate: OPENCLAW_CONFIG.buildDate,
    features: OPENCLAW_CONFIG.features,
    models: Object.keys(OPENCLAW_CONFIG.models),
    skillCount: skillsRegistry.listSkills().length,
    costReport,
  });
});

/**
 * GET /api/openclaw/models
 * List available models and their configurations
 */
router.get('/models', (_req: Request, res: Response) => {
  const models = Object.entries(OPENCLAW_CONFIG.models).map(([id, config]) => ({
    id,
    provider: config.provider,
    role: config.role,
    capabilities: config.capabilities,
    costPerMillionTokens: config.costPerMillionTokens,
  }));

  return res.json({ success: true, models });
});

export { router as openclawBridgeRouter };
export default router;
