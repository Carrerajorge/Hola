import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError, isOperationalError } from '../utils/errors';
import { CircuitBreakerError } from '../utils/circuitBreaker';
import { createLogger } from '../utils/logger';

const logger = createLogger('error-handler');

interface ErrorResponse {
  error: {
    message: string;
    code: string;
    traceId?: string;
    details?: Record<string, unknown>;
  };
}

function getTraceId(req: Request, res: Response): string | undefined {
  return res.locals?.traceId || req.headers['x-trace-id'] as string | undefined;
}

function sanitizeErrorForProduction(error: AppError, traceId?: string): ErrorResponse {
  return {
    error: {
      message: error.message,
      code: error.code,
      traceId,
      details: error.details,
    },
  };
}

function sanitizeUnknownErrorForProduction(traceId?: string): ErrorResponse {
  return {
    error: {
      message: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
      traceId,
    },
  };
}

function getFullErrorDetails(error: Error, req: Request): Record<string, unknown> {
  return {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    query: req.query,
    body: req.body,
    headers: {
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type'],
    },
    timestamp: new Date().toISOString(),
    userId: (req as any).user?.id,
  };
}

function logError(error: Error, req: Request, res: Response, statusCode: number): void {
  const traceId = getTraceId(req, res);
  const logContext = {
    statusCode,
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
    traceId,
    errorName: error.name,
    errorMessage: error.message,
  };

  if (statusCode >= 500) {
    logger.error('Server error', { ...logContext, stack: error.stack });
  } else if (statusCode >= 400) {
    logger.warn('Client error', logContext);
  }
}

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const traceId = getTraceId(req, res);

  if (err instanceof CircuitBreakerError) {
    const statusCode = 503;
    logError(err, req, res, statusCode);

    res.status(statusCode).json({
      error: {
        message: 'Service temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE',
        traceId,
        details: isProduction ? undefined : {
          state: err.state,
          nextAttemptAt: err.nextAttemptAt.toISOString(),
        },
      },
    });
    return;
  }

  if (err instanceof AppError) {
    logError(err, req, res, err.statusCode);

    if (isProduction) {
      res.status(err.statusCode).json(sanitizeErrorForProduction(err, traceId));
    } else {
      res.status(err.statusCode).json({
        error: {
          message: err.message,
          code: err.code,
          traceId,
          details: err.details,
          stack: err.stack,
        },
      });
    }
    return;
  }

  const statusCode = (err as any).status || (err as any).statusCode || 500;
  logError(err, req, res, statusCode);

  if (!isOperationalError(err)) {
    logger.error('Unhandled non-operational error', getFullErrorDetails(err, req));
  }

  if (isProduction) {
    res.status(statusCode).json(sanitizeUnknownErrorForProduction(traceId));
  } else {
    res.status(statusCode).json({
      error: {
        message: err.message || 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        traceId,
        stack: err.stack,
      },
    });
  }
};

export const notFoundHandler = (req: Request, res: Response): void => {
  const traceId = getTraceId(req, res);
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'NOT_FOUND',
      traceId,
    },
  });
};

export const asyncHandler = <T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
