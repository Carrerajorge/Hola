/**
 * SuperAgent API Routes
 *
 * Exposes REST endpoints for the SuperAgent capabilities:
 * - /api/superagent/status — Full status and stats
 * - /api/superagent/task — Submit and classify tasks
 * - /api/superagent/background — Manage background tasks
 * - /api/superagent/research — Parallel research queries
 * - /api/superagent/connectors — Tool connector management
 * - /api/superagent/create — Creation engine
 * - /api/superagent/integrations — Open source integrations catalog
 */

import { Router, type Request, type Response } from 'express';
import { getSuperAgentStatus } from './index';
import { multiModelOrchestrator } from './multiModelOrchestrator';
import { backgroundTaskEngine, type BackgroundTask } from './backgroundTaskEngine';
import { browserAutomationEngine } from './browserAutomationEngine';
import { toolConnectorFramework } from './toolConnectorFramework';
import { creationEngine } from './creationEngine';
import { openSourceRegistry } from './openSourceIntegrations';

export function createSuperAgentRouter(): Router {
  const router = Router();

  // ─── Status ───
  router.get('/status', (_req: Request, res: Response) => {
    res.json(getSuperAgentStatus());
  });

  // ─── Multi-Model Task Routing ───
  router.post('/task', async (req: Request, res: Response) => {
    try {
      const { prompt, type, priority } = req.body;
      const taskType = type || multiModelOrchestrator.classifyTask(prompt || '');
      const model = multiModelOrchestrator.resolveModel(taskType);

      const result = await multiModelOrchestrator.executeTask({
        id: `task-${Date.now()}`,
        type: taskType,
        prompt: prompt || '',
        priority: priority || 'standard',
      });

      res.json({ ok: true, task: result, resolvedModel: model });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/task/classify', (req: Request, res: Response) => {
    const { prompt } = req.body;
    const taskType = multiModelOrchestrator.classifyTask(prompt || '');
    const model = multiModelOrchestrator.resolveModel(taskType);
    res.json({ taskType, model: { id: model.id, name: model.model, provider: model.provider, role: model.role } });
  });

  router.get('/task/models', (_req: Request, res: Response) => {
    res.json(multiModelOrchestrator.getStats());
  });

  // ─── Background Tasks ───
  router.get('/background', (_req: Request, res: Response) => {
    res.json({ tasks: backgroundTaskEngine.listTasks(), stats: backgroundTaskEngine.getStats() });
  });

  router.post('/background', async (req: Request, res: Response) => {
    try {
      const task: BackgroundTask = {
        id: req.body.id || `bg-${Date.now()}`,
        name: req.body.name,
        description: req.body.description || '',
        schedule: req.body.schedule || { type: 'once' },
        handler: req.body.handler || 'default',
        params: req.body.params || {},
        status: 'pending',
        priority: req.body.priority || 'normal',
        createdAt: new Date(),
        runCount: 0,
        errorCount: 0,
        tags: req.body.tags || [],
      };

      const registered = await backgroundTaskEngine.registerTask(task);
      res.json({ ok: true, task: registered });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.delete('/background/:taskId', async (req: Request, res: Response) => {
    const cancelled = await backgroundTaskEngine.cancelTask(req.params.taskId);
    res.json({ ok: cancelled });
  });

  router.post('/background/:taskId/pause', async (req: Request, res: Response) => {
    const paused = await backgroundTaskEngine.pauseTask(req.params.taskId);
    res.json({ ok: paused });
  });

  router.post('/background/:taskId/resume', async (req: Request, res: Response) => {
    const resumed = await backgroundTaskEngine.resumeTask(req.params.taskId);
    res.json({ ok: resumed });
  });

  // ─── Browser Automation & Research ───
  router.post('/research', async (req: Request, res: Response) => {
    try {
      const queries = Array.isArray(req.body.queries) ? req.body.queries : [req.body];
      const results = await browserAutomationEngine.startResearch(queries);
      res.json({ ok: true, results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.get('/research/:queryId', (req: Request, res: Response) => {
    const result = browserAutomationEngine.getResearchStatus(req.params.queryId);
    if (!result) return res.status(404).json({ ok: false, error: 'Query not found' });
    res.json({ ok: true, result });
  });

  router.post('/browser/session', async (_req: Request, res: Response) => {
    const session = await browserAutomationEngine.createBrowserSession();
    res.json({ ok: true, session });
  });

  router.post('/browser/session/:sessionId/action', async (req: Request, res: Response) => {
    try {
      const result = await browserAutomationEngine.executeAction(req.params.sessionId, req.body);
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  // ─── Tool Connectors ───
  router.get('/connectors', (req: Request, res: Response) => {
    const category = req.query.category as string | undefined;
    const connectors = toolConnectorFramework.listConnectors(category as any);
    res.json({ connectors, stats: toolConnectorFramework.getStats() });
  });

  router.get('/connectors/:id', (req: Request, res: Response) => {
    const connector = toolConnectorFramework.getConnector(req.params.id);
    if (!connector) return res.status(404).json({ ok: false, error: 'Connector not found' });
    res.json({ ok: true, connector });
  });

  router.post('/connectors/:id/execute', async (req: Request, res: Response) => {
    try {
      const { actionId, input } = req.body;
      const result = await toolConnectorFramework.executeAction(req.params.id, actionId, input || {});
      res.json({ ok: true, execution: result });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  // ─── Creation Engine ───
  router.post('/create', async (req: Request, res: Response) => {
    try {
      const request = {
        id: req.body.id || `create-${Date.now()}`,
        type: req.body.type || 'app',
        title: req.body.title,
        description: req.body.description || '',
        requirements: req.body.requirements || [],
        techStack: req.body.techStack,
        outputFormat: req.body.outputFormat,
      };
      const result = await creationEngine.executeCreation(request);
      res.json({ ok: true, creation: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/create/plan', async (req: Request, res: Response) => {
    try {
      const plan = await creationEngine.planCreation(req.body);
      res.json({ ok: true, plan });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ─── Open Source Integrations ───
  router.get('/integrations', (req: Request, res: Response) => {
    const category = req.query.category as string | undefined;
    const status = req.query.status as string | undefined;

    let projects = openSourceRegistry.listAll();
    if (category) projects = projects.filter(p => p.category === category);
    if (status) projects = projects.filter(p => p.status === status);

    res.json({ projects, stats: openSourceRegistry.getStats() });
  });

  router.get('/integrations/summary', (_req: Request, res: Response) => {
    res.json({ summary: openSourceRegistry.getIntegrationSummary() });
  });

  router.get('/integrations/:id', (req: Request, res: Response) => {
    const project = openSourceRegistry.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'Project not found' });
    res.json({ ok: true, project });
  });

  return router;
}
