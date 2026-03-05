"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTelemetry = createTelemetry;
function createTelemetry(otelEndpoint) {
    if (!otelEndpoint) {
        return {
            startSpan: (_name) => noopSpan(),
            shutdown: async () => undefined,
        };
    }
    return {
        startSpan(name, attributes) {
            const startedAt = Date.now();
            return {
                end(extra) {
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
                fail(error, extra) {
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
function noopSpan() {
    return {
        end: () => undefined,
        fail: () => undefined,
    };
}
