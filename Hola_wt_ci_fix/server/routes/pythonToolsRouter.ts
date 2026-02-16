import { Router, Request, Response } from 'express';
import { pythonToolsClient, PythonToolsClientError } from '../lib/pythonToolsClient';

export function createPythonToolsRouter(): Router {
  const router = Router();

  router.get('/python-tools/health', async (_req: Request, res: Response) => {
    try {
      const health = await pythonToolsClient.health();
      res.json({
        success: true,
        ...health
      });
    } catch (error) {
      console.error('[PythonToolsRouter] Health check failed:', error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 503).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(503).json({
        success: false,
        error: 'Python Tools API is unavailable',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-tools', async (_req: Request, res: Response) => {
    try {
      const tools = await pythonToolsClient.listTools();
      res.json({
        success: true,
        count: tools.length,
        tools
      });
    } catch (error) {
      console.error('[PythonToolsRouter] List tools failed:', error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to list Python tools',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-tools/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const tool = await pythonToolsClient.getTool(name);
      res.json({
        success: true,
        tool
      });
    } catch (error) {
      console.error(`[PythonToolsRouter] Get tool '${req.params.name}' failed:`, error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to get tool '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/python-tools/:name/execute', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { input = {} } = req.body;
      
      console.log(`[PythonToolsRouter] Executing tool '${name}'`);
      
      const result = await pythonToolsClient.executeTool(name, input);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error(`[PythonToolsRouter] Execute tool '${req.params.name}' failed:`, error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to execute tool '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-agents', async (_req: Request, res: Response) => {
    try {
      const agents = await pythonToolsClient.listAgents();
      res.json({
        success: true,
        count: agents.length,
        agents
      });
    } catch (error) {
      console.error('[PythonToolsRouter] List agents failed:', error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to list Python agents',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-agents/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const agent = await pythonToolsClient.getAgent(name);
      res.json({
        success: true,
        agent
      });
    } catch (error) {
      console.error(`[PythonToolsRouter] Get agent '${req.params.name}' failed:`, error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to get agent '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/python-agents/:name/execute', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { task, context } = req.body;
      
      if (!task) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: task'
        });
      }
      
      console.log(`[PythonToolsRouter] Executing agent '${name}' with task: ${task.substring(0, 100)}...`);
      
      const result = await pythonToolsClient.executeAgent(name, task, context);
      
      res.json({
        success: true,
        result
      });
    } catch (error) {
      console.error(`[PythonToolsRouter] Execute agent '${req.params.name}' failed:`, error);
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to execute agent '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}

export default createPythonToolsRouter;
