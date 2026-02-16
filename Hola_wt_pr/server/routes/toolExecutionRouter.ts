import { Router, Request, Response } from 'express';
import {
  toolExecutionEngine,
  initializeToolExecutionEngine,
  type ExecutionOptions,
  type ExecutionProgress,
} from '../services/toolExecutionEngine';
import { createLogger } from '../lib/structuredLogger';

const logger = createLogger('tool-execution-router');

export function createToolExecutionRouter(): Router {
  const router = Router();

  initializeToolExecutionEngine().catch((error) => {
    logger.error('Failed to initialize tool execution engine', { error });
  });

  router.get('/tools', async (req: Request, res: Response) => {
    try {
      const { type, category, refresh } = req.query;
      const tools = await toolExecutionEngine.listTools({
        type: type as any,
        category: category as string,
        refresh: refresh === 'true',
      });
      res.json({
        success: true,
        count: tools.length,
        tools,
      });
    } catch (error: any) {
      logger.error('Failed to list tools', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/tools/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const tool = await toolExecutionEngine.getTool(name);
      if (!tool) {
        return res.status(404).json({
          success: false,
          error: `Tool '${name}' not found`,
        });
      }
      res.json({
        success: true,
        tool,
      });
    } catch (error: any) {
      logger.error(`Failed to get tool '${req.params.name}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/tools/:name/execute', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { input = {}, options = {} } = req.body;

      const executionOptions: ExecutionOptions = {
        timeout: options.timeout,
        maxRetries: options.maxRetries,
        userId: options.userId || (req as any).userId,
        skipCache: options.skipCache,
      };

      logger.info(`Executing tool '${name}'`, { input, options: executionOptions });

      const result = await toolExecutionEngine.execute(name, input, executionOptions);

      res.json({
        success: result.success,
        executionId: result.executionId,
        data: result.data,
        error: result.error,
        errorCode: result.errorCode,
        metrics: result.metrics,
      });
    } catch (error: any) {
      logger.error(`Failed to execute tool '${req.params.name}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/executions/active', async (_req: Request, res: Response) => {
    try {
      const executions = toolExecutionEngine.getActiveExecutions();
      res.json({
        success: true,
        count: executions.length,
        executions,
      });
    } catch (error: any) {
      logger.error('Failed to get active executions', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/executions/:executionId/cancel', async (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;
      const cancelled = await toolExecutionEngine.cancelExecution(executionId);
      res.json({
        success: cancelled,
        message: cancelled ? 'Execution cancelled' : 'Execution not found or already completed',
      });
    } catch (error: any) {
      logger.error(`Failed to cancel execution '${req.params.executionId}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/history', async (req: Request, res: Response) => {
    try {
      const { toolName, userId, limit, successOnly } = req.query;
      const history = toolExecutionEngine.getExecutionHistory({
        toolName: toolName as string,
        userId: userId as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        successOnly: successOnly === 'true',
      });
      res.json({
        success: true,
        count: history.length,
        history,
      });
    } catch (error: any) {
      logger.error('Failed to get execution history', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/analytics', async (_req: Request, res: Response) => {
    try {
      const analytics = toolExecutionEngine.getEngineAnalytics();
      res.json({
        success: true,
        analytics: {
          ...analytics,
          toolAnalytics: Object.fromEntries(analytics.toolAnalytics),
        },
      });
    } catch (error: any) {
      logger.error('Failed to get analytics', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/analytics/:toolName', async (req: Request, res: Response) => {
    try {
      const { toolName } = req.params;
      const analytics = toolExecutionEngine.getToolAnalytics(toolName);
      if (!analytics) {
        return res.status(404).json({
          success: false,
          error: `No analytics found for tool '${toolName}'`,
        });
      }
      res.json({
        success: true,
        analytics,
      });
    } catch (error: any) {
      logger.error(`Failed to get analytics for '${req.params.toolName}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/circuit-breaker/:toolName', async (req: Request, res: Response) => {
    try {
      const { toolName } = req.params;
      const status = toolExecutionEngine.getCircuitBreakerStatus(toolName);
      if (!status) {
        return res.status(404).json({
          success: false,
          error: `No circuit breaker found for tool '${toolName}'`,
        });
      }
      res.json({
        success: true,
        toolName,
        ...status,
      });
    } catch (error: any) {
      logger.error(`Failed to get circuit breaker status for '${req.params.toolName}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/circuit-breaker/:toolName/reset', async (req: Request, res: Response) => {
    try {
      const { toolName } = req.params;
      toolExecutionEngine.resetCircuitBreaker(toolName);
      res.json({
        success: true,
        message: `Circuit breaker reset for tool '${toolName}'`,
      });
    } catch (error: any) {
      logger.error(`Failed to reset circuit breaker for '${req.params.toolName}'`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/cache/clear', async (_req: Request, res: Response) => {
    try {
      toolExecutionEngine.clearCache();
      res.json({
        success: true,
        message: 'Tool cache cleared',
      });
    } catch (error: any) {
      logger.error('Failed to clear cache', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/tools/refresh', async (_req: Request, res: Response) => {
    try {
      const tools = await toolExecutionEngine.refreshTools();
      res.json({
        success: true,
        count: tools.length,
        tools,
      });
    } catch (error: any) {
      logger.error('Failed to refresh tools', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

export function setupToolExecutionWebSocket(
  wss: any,
  path: string = '/tool-execution'
): void {
  const clients = new Set<any>();

  const unsubscribeProgress = toolExecutionEngine.subscribeToProgress((progress: ExecutionProgress) => {
    const message = JSON.stringify({
      type: 'progress',
      data: progress,
    });
    clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  });

  const unsubscribeCircuit = toolExecutionEngine.subscribeToCircuitChanges((event) => {
    const message = JSON.stringify({
      type: 'circuit_state_change',
      data: event,
    });
    clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  });

  wss.on('connection', (ws: any, req: any) => {
    if (req.url?.startsWith(path)) {
      clients.add(ws);
      logger.info('Tool execution WebSocket client connected', { clientCount: clients.size });

      ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to tool execution engine',
      }));

      ws.on('close', () => {
        clients.delete(ws);
        logger.info('Tool execution WebSocket client disconnected', { clientCount: clients.size });
      });

      ws.on('message', async (data: any) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'execute') {
            const { toolName, input, options } = message;
            const result = await toolExecutionEngine.execute(toolName, input, {
              ...options,
              onProgress: (progress) => {
                ws.send(JSON.stringify({
                  type: 'progress',
                  data: progress,
                }));
              },
            });
            ws.send(JSON.stringify({
              type: 'result',
              data: result,
            }));
          } else if (message.type === 'cancel') {
            const { executionId } = message;
            const cancelled = await toolExecutionEngine.cancelExecution(executionId);
            ws.send(JSON.stringify({
              type: 'cancelled',
              data: { executionId, cancelled },
            }));
          }
        } catch (error: any) {
          ws.send(JSON.stringify({
            type: 'error',
            error: error.message,
          }));
        }
      });
    }
  });
}

export default createToolExecutionRouter;
