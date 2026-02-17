import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const MAX_ERROR_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 4000;
const MAX_URL_LENGTH = 2048;
const MAX_UA_LENGTH = 512;
const MAX_COMPONENT_NAME_LENGTH = 128;

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

function sanitizeString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, maxLength);
}

function sanitizeErrorId(value: unknown): string {
  const raw = sanitizeString(value, MAX_ERROR_ID_LENGTH);
  return raw.replace(/[^a-zA-Z0-9._\-:]/g, '');
}

function requireAdmin(req: Request, res: Response): boolean {
  const user = (req as any).user;
  if (!user?.id) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

router.post('/log', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const errorLog: ErrorLog = {
      errorId: sanitizeErrorId(body.errorId) || `err_${Date.now()}`,
      message: sanitizeString(body.message, MAX_MESSAGE_LENGTH),
      stack: body.stack ? sanitizeString(body.stack, MAX_STACK_LENGTH) : undefined,
      componentStack: body.componentStack ? sanitizeString(body.componentStack, MAX_STACK_LENGTH) : undefined,
      componentName: body.componentName ? sanitizeString(body.componentName, MAX_COMPONENT_NAME_LENGTH) : undefined,
      url: sanitizeString(body.url, MAX_URL_LENGTH),
      userAgent: sanitizeString(body.userAgent, MAX_UA_LENGTH),
      timestamp: new Date().toISOString(),
      userId: (req as any).user?.id ?? undefined,
      sessionId: typeof (req as any).sessionID === 'string' ? (req as any).sessionID : undefined,
    };

    errorLogs.unshift(errorLog);
    if (errorLogs.length > MAX_LOGS) {
      errorLogs.pop();
    }

    console.error('[CLIENT ERROR]', {
      errorId: errorLog.errorId,
      component: errorLog.componentName,
      message: errorLog.message.slice(0, 200),
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
    if (!requireAdmin(req, res)) return;

    const rawLimit = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const component = typeof req.query.component === 'string'
      ? sanitizeString(req.query.component, MAX_COMPONENT_NAME_LENGTH)
      : undefined;

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
    if (!requireAdmin(req, res)) return;

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
