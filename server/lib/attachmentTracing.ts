/**
 * OpenTelemetry tracing for the attachment pipeline.
 *
 * Provides lightweight span creation for:
 *  - attachment.upload
 *  - attachment.pipeline.process
 *  - attachment.pipeline.parse_document
 *  - attachment.pipeline.process_image
 *  - attachment.retrieval.hybrid
 *  - attachment.retrieval.bm25
 *  - attachment.retrieval.vector
 *
 * Gracefully no-ops when OpenTelemetry is not configured.
 */

interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

let tracer: any = null;

// Try to load OpenTelemetry API if available
try {
  const api = require("@opentelemetry/api");
  tracer = api.trace.getTracer("attachment-pipeline", "1.0.0");
} catch {
  // OpenTelemetry not installed — no-op tracing
}

/**
 * Create a tracing span for an attachment operation.
 * Returns null if OpenTelemetry is not configured, allowing
 * callers to use optional chaining: span?.setAttribute(...)
 */
export function traceAttachmentOp(operationName: string): SpanLike | null {
  if (!tracer) return null;

  try {
    const span = tracer.startSpan(operationName, {
      attributes: {
        "service.component": "attachment-pipeline",
        "operation.name": operationName,
      },
    });

    return {
      setAttribute(key: string, value: string | number | boolean) {
        try { span.setAttribute(key, value); } catch { /* noop */ }
      },
      setStatus(status: { code: number; message?: string }) {
        try { span.setStatus(status); } catch { /* noop */ }
      },
      end() {
        try { span.end(); } catch { /* noop */ }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Instrument an async function with a trace span.
 * Automatically handles span lifecycle and error status.
 */
export async function withAttachmentTrace<T>(
  operationName: string,
  fn: (span: SpanLike | null) => Promise<T>
): Promise<T> {
  const span = traceAttachmentOp(operationName);
  try {
    const result = await fn(span);
    span?.setStatus({ code: 0 });
    return result;
  } catch (error: any) {
    span?.setStatus({ code: 2, message: error.message });
    throw error;
  } finally {
    span?.end();
  }
}
