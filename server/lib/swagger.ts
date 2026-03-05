import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "ILIAGPT PRO API",
      version: "1.0.0",
      description: "API documentation for ILIAGPT PRO 3.0",
      contact: {
        name: "API Support",
        email: "support@iliagpt.com",
      },
    },
    servers: [
      {
        url: "/api",
        description: "Main API Server",
      },
    ],
    tags: [
      {
        name: "RunTraces",
        description: "Workflow run-traces lifecycle, events, SSE and WebSocket streaming",
      },
    ],
    paths: {
      "/run-traces/runs": {
        post: {
          tags: ["RunTraces"],
          summary: "Create a workflow run",
          description:
            "Creates a new workflow run. Supports idempotent creation by (chatId, idempotencyKey).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorkflowRunCreateRequest",
                },
                examples: {
                  minimal: {
                    value: {
                      chatId: "chat_123",
                      idempotencyKey: "wf-2026-02-28-001",
                      plan: {
                        objective: "Prepare and publish report",
                        concurrency: 1,
                        steps: [
                          {
                            id: "prepare",
                            name: "Prepare",
                            toolName: "noop",
                            executorKey: "noop",
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Run created",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/WorkflowRunCreateResponse",
                  },
                },
              },
            },
            "200": {
              description: "Idempotent replay hit existing run",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/WorkflowRunCreateResponse",
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/run-traces/runs/{id}": {
        get: {
          tags: ["RunTraces"],
          summary: "Get workflow run details",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Workflow run state",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/WorkflowRunDetails",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/run-traces/runs/{id}/events": {
        get: {
          tags: ["RunTraces"],
          summary: "List persisted run events",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "afterSeq",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 0 },
              description: "Return events with event_seq > afterSeq",
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500 },
            },
            {
              name: "order",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["asc", "desc"] },
            },
          ],
          responses: {
            "200": {
              description: "Persisted run events",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/WorkflowEventsResponse",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/run-traces/runs/{id}/stream": {
        get: {
          tags: ["RunTraces"],
          summary: "Stream run events via SSE",
          description:
            "Ordered SSE stream. Supports reconnection via Last-Event-ID (event_seq), catch-up from durable store, and retry hints.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "lastEventId",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 0 },
              description: "Alternative to Last-Event-ID header for catch-up",
            },
            {
              name: "Last-Event-ID",
              in: "header",
              required: false,
              schema: { type: "integer", minimum: 0 },
              description: "Standard SSE reconnection cursor (event_seq)",
            },
          ],
          responses: {
            "200": {
              description: "text/event-stream",
              headers: {
                "Content-Type": {
                  schema: { type: "string" },
                  description: "text/event-stream",
                },
              },
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    example:
                      "retry: 1500\\nid: 12\\nevent: step_completed\\ndata: {\"event_seq\":12,\"event_type\":\"step_completed\"}\\n\\n",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/run-traces/runs/{id}/cancel": {
        post: {
          tags: ["RunTraces"],
          summary: "Cancel workflow run",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Run cancellation accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      runId: { type: "string" },
                      cancelled: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "409": {
              description: "Run cannot be cancelled in current state",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/ws/run-traces": {
        get: {
          tags: ["RunTraces"],
          summary: "WebSocket run-traces channel",
          description:
            "Upgrade endpoint. Client sends {type:\"subscribe\",runId,lastEventId}. Server replies with ordered events and durable catch-up from lastEventId.",
          responses: {
            "101": {
              description: "WebSocket upgrade",
            },
          },
          "x-websocket": {
            subscribeMessage: {
              type: "object",
              required: ["type", "runId"],
              properties: {
                type: { type: "string", enum: ["subscribe"] },
                runId: { type: "string" },
                lastEventId: { type: "integer", minimum: 0 },
              },
            },
            eventMessage: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["event"] },
                id: { type: "integer" },
                event: { type: "string" },
                data: {
                  $ref: "#/components/schemas/WorkflowStreamEvent",
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "connect.sid",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              description: "Error message",
            },
            detail: {
              type: "string",
            },
          },
        },
        WorkflowRunCreateRequest: {
          type: "object",
          required: ["chatId", "plan"],
          properties: {
            chatId: { type: "string" },
            userId: { type: "string", nullable: true },
            idempotencyKey: { type: "string" },
            traceId: { type: "string" },
            variables: {
              type: "object",
              additionalProperties: true,
            },
            plan: {
              $ref: "#/components/schemas/WorkflowPlan",
            },
          },
        },
        WorkflowPlan: {
          type: "object",
          required: ["objective", "steps"],
          properties: {
            objective: { type: "string" },
            concurrency: { type: "integer", minimum: 1 },
            metadata: {
              type: "object",
              additionalProperties: true,
            },
            steps: {
              type: "array",
              minItems: 1,
              items: {
                $ref: "#/components/schemas/WorkflowStep",
              },
            },
          },
        },
        WorkflowStep: {
          type: "object",
          required: ["id", "name", "toolName"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            toolName: { type: "string" },
            executorKey: { type: "string" },
            description: { type: "string" },
            dependencies: {
              type: "array",
              items: { type: "string" },
            },
            timeoutMs: { type: "integer", minimum: 1 },
            retryPolicy: {
              type: "object",
              properties: {
                attempts: { type: "integer", minimum: 1 },
                backoffMs: { type: "integer", minimum: 0 },
                maxBackoffMs: { type: "integer", minimum: 0 },
              },
            },
            metadata: {
              type: "object",
              additionalProperties: true,
            },
            input: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        WorkflowRunCreateResponse: {
          type: "object",
          properties: {
            runId: { type: "string" },
            reused: { type: "boolean" },
            streamUrl: { type: "string" },
          },
        },
        WorkflowRunDetails: {
          type: "object",
          properties: {
            id: { type: "string" },
            chatId: { type: "string" },
            status: { type: "string" },
            error: { type: "string", nullable: true },
            totalSteps: { type: "integer" },
            completedSteps: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
            startedAt: { type: "string", format: "date-time", nullable: true },
            completedAt: { type: "string", format: "date-time", nullable: true },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  stepIndex: { type: "integer" },
                  toolName: { type: "string" },
                  status: { type: "string" },
                  retryCount: { type: "integer" },
                  error: { type: "string", nullable: true },
                },
              },
            },
            artifacts: {
              type: "array",
              items: {
                $ref: "#/components/schemas/WorkflowArtifact",
              },
            },
          },
        },
        WorkflowArtifact: {
          type: "object",
          properties: {
            id: { type: "string" },
            stepId: { type: "string" },
            stepIndex: { type: "integer" },
            artifactKey: { type: "string" },
            type: { type: "string" },
            name: { type: "string" },
            url: { type: "string", nullable: true },
            payload: {
              type: "object",
              nullable: true,
              additionalProperties: true,
            },
            metadata: {
              type: "object",
              nullable: true,
              additionalProperties: true,
            },
          },
        },
        WorkflowEventsResponse: {
          type: "object",
          properties: {
            runId: { type: "string" },
            order: { type: "string" },
            limit: { type: "integer" },
            afterSeq: { type: "integer", nullable: true },
            lastEventSeq: { type: "integer" },
            events: {
              type: "array",
              items: {
                $ref: "#/components/schemas/WorkflowStreamEvent",
              },
            },
          },
        },
        WorkflowStreamEvent: {
          type: "object",
          properties: {
            event_seq: { type: "integer" },
            event_type: { type: "string" },
            runId: { type: "string" },
            correlation_id: { type: "string" },
            trace_id: { type: "string", nullable: true },
            span_id: { type: "string", nullable: true },
            stepId: { type: "string", nullable: true },
            stepIndex: { type: "integer", nullable: true },
            severity: { type: "string", enum: ["info", "warning", "error"] },
            metadata: {
              type: "object",
              additionalProperties: true,
            },
            timestamp: { type: "integer" },
          },
          additionalProperties: true,
        },
      },
      responses: {
        BadRequest: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
        Unauthorized: {
          description: "Authentication required",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
        NotFound: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
        InternalError: {
          description: "Internal server error",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
      },
    },
    security: [
      {
        cookieAuth: [],
      },
    ],
  },
  apis: [],
};

function buildSwaggerSpec() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.CI === "true" ||
    process.env.NODE_ENV === "test"
  ) {
    return options.swaggerDefinition as any;
  }

  try {
    return swaggerJsdoc(options);
  } catch (err) {
    console.warn("[Swagger] swagger-jsdoc generation failed; using static definition", err);
    return options.swaggerDefinition as any;
  }
}

export const swaggerSpec = buildSwaggerSpec();
