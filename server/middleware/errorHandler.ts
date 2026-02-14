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

// SECURITY FIX #6: Fields to exclude from error logging (sensitive data)
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization', 'cookie', 'session', 'credit_card', 'ssn', 'cvv'];

// SECURITY FIX #7: Sanitize object by removing sensitive fields
function sanitizeForLogging(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function getFullErrorDetails(error: Error, req: Request): Record<string, unknown> {
  return {
    message: error.message,
    // SECURITY FIX #8: Never include stack traces in production logs
    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    path: req.path,
    method: req.method,
    // SECURITY FIX #9: Sanitize query params (may contain tokens)
    query: sanitizeForLogging(req.query as Record<string, unknown>),
    // SECURITY FIX #10: Sanitize request body (may contain passwords)
    body: sanitizeForLogging(req.body),
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
