import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

interface ErrorLog {
  errorId: string;
  message: string;
  stack?: string;
  componentStack?: string;
  componentName?: string;
  url: string;
  userAgent: string;
  timestamp: string;
  userId?: number;
  sessionId?: string;
}

const errorLogs: ErrorLog[] = [];
const MAX_LOGS = 1000;

router.post('/log', async (req: Request, res: Response) => {
  try {
    const errorLog: ErrorLog = {
      ...req.body,
      userId: (req as any).user?.id,
      sessionId: (req as any).sessionID
    };

    errorLogs.unshift(errorLog);
    if (errorLogs.length > MAX_LOGS) {
      errorLogs.pop();
    }

    console.error('[CLIENT ERROR]', {
      errorId: errorLog.errorId,
      component: errorLog.componentName,
      message: errorLog.message,
      url: errorLog.url,
      timestamp: errorLog.timestamp
    });

    res.json({ success: true, errorId: errorLog.errorId });
  } catch (error) {
    console.error('Error logging client error:', error);
    res.status(500).json({ error: 'Failed to log error' });
  }
});

router.get('/recent', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const component = req.query.component as string;

    let filtered = errorLogs;
    if (component) {
      filtered = errorLogs.filter(e => e.componentName === component);
    }

    res.json({
      errors: filtered.slice(0, limit),
      total: filtered.length,
      components: [...new Set(errorLogs.map(e => e.componentName).filter(Boolean))]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch errors' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const errors24h = errorLogs.filter(e => new Date(e.timestamp) > last24h);
    const errorsWeek = errorLogs.filter(e => new Date(e.timestamp) > lastWeek);

    const byComponent: Record<string, number> = {};
    errorLogs.forEach(e => {
      const name = e.componentName || 'Unknown';
      byComponent[name] = (byComponent[name] || 0) + 1;
    });

    const byMessage: Record<string, number> = {};
    errorLogs.forEach(e => {
      const msg = e.message.slice(0, 100);
      byMessage[msg] = (byMessage[msg] || 0) + 1;
    });

    const topErrors = Object.entries(byMessage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    res.json({
      total: errorLogs.length,
      last24Hours: errors24h.length,
      lastWeek: errorsWeek.length,
      byComponent,
      topErrors,
      healthScore: calculateHealthScore(errors24h.length)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

function calculateHealthScore(errorsIn24h: number): number {
  if (errorsIn24h === 0) return 100;
  if (errorsIn24h < 5) return 90;
  if (errorsIn24h < 20) return 75;
  if (errorsIn24h < 50) return 50;
  if (errorsIn24h < 100) return 25;
  return 10;
}

export default router;
