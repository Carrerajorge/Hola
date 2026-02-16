import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError, isOperationalError } from '../utils/errors';
import { CircuitBreakerError } from '../utils/circuitBreaker';

interface ErrorResponse {
  error: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  };
}

function sanitizeErrorForProduction(error: AppError): ErrorResponse {
  return {
    error: {
      message: error.message,
      code: error.code,
      details: error.details,
    },
  };
}

function sanitizeUnknownErrorForProduction(): ErrorResponse {
  return {
    error: {
      message: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
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

function logError(error: Error, req: Request, statusCode: number): void {
  const logContext = {
    statusCode,
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
    requestId: (req as any).requestId,
    errorName: error.name,
    errorMessage: error.message,
  };

  if (statusCode >= 500) {
    console.error('[ErrorHandler] Server error:', logContext, '\nStack:', error.stack);
  } else if (statusCode >= 400) {
    console.warn('[ErrorHandler] Client error:', logContext);
  }
}

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (err instanceof CircuitBreakerError) {
    const statusCode = 503;
    logError(err, req, statusCode);
    
    res.status(statusCode).json({
      error: {
        message: 'Service temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE',
        details: isProduction ? undefined : {
          state: err.state,
          nextAttemptAt: err.nextAttemptAt.toISOString(),
        },
      },
    });
    return;
  }

  if (err instanceof AppError) {
    logError(err, req, err.statusCode);
    
    if (isProduction) {
      res.status(err.statusCode).json(sanitizeErrorForProduction(err));
    } else {
      res.status(err.statusCode).json({
        error: {
          message: err.message,
          code: err.code,
          details: err.details,
          stack: err.stack,
        },
      });
    }
    return;
  }

  const statusCode = (err as any).status || (err as any).statusCode || 500;
  logError(err, req, statusCode);

  if (!isOperationalError(err)) {
    console.error('[ErrorHandler] Unhandled error:', getFullErrorDetails(err, req));
  }

  if (isProduction) {
    res.status(statusCode).json(sanitizeUnknownErrorForProduction());
  } else {
    res.status(statusCode).json({
      error: {
        message: err.message || 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        stack: err.stack,
      },
    });
  }
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'NOT_FOUND',
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
