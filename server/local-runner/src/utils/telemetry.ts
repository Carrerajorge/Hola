import { SpanHandle, Telemetry } from "../types";

export function createTelemetry(otelEndpoint?: string): Telemetry {
  if (!otelEndpoint) {
    return {
      startSpan: (_name: string) => noopSpan(),
      shutdown: async () => undefined,
    };
  }

  return {
    startSpan(name: string, attributes?: Record<string, unknown>) {
      const startedAt = Date.now();
      return {
        end(extra?: Record<string, unknown>) {
          const payload = {
            type: "otel_span",
            endpoint: otelEndpoint,
            name,
            status: "ok",
            durationMs: Date.now() - startedAt,
            ...attributes,
            ...extra,
          };
          process.stderr.write(`${JSON.stringify(payload)}\n`);
        },
        fail(error: Error | string, extra?: Record<string, unknown>) {
          const payload = {
            type: "otel_span",
            endpoint: otelEndpoint,
            name,
            status: "error",
            durationMs: Date.now() - startedAt,
            error: typeof error === "string" ? error : error.message,
            ...attributes,
            ...extra,
          };
          process.stderr.write(`${JSON.stringify(payload)}\n`);
        },
      };
    },
    shutdown: async () => undefined,
  };
}

function noopSpan(): SpanHandle {
  return {
    end: () => undefined,
    fail: () => undefined,
  };
}
