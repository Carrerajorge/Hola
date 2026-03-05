# API Documentation

## Workflow Endpoints

### Start Workflow

**POST** `/api/registry/workflows`

Start a new workflow execution.

**Request:**
```json
{
  "query": "crea una imagen de un gato"
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "runId": "uuid",
  "requestId": "uuid",
  "statusUrl": "/api/registry/workflows/{runId}",
  "eventsUrl": "/api/registry/workflows/{runId}/events"
}
```

**Example:**
```bash
curl -X POST http://localhost:5000/api/registry/workflows \
  -H "Content-Type: application/json" \
  -d '{"query":"crea una imagen de un gato"}'
```

### Get Workflow Status

**GET** `/api/registry/workflows/:runId`

Get current state of a workflow.

**Response:**
```json
{
  "success": true,
  "data": {
    "runId": "uuid",
    "requestId": "uuid",
    "status": "completed",
    "startedAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:01.000Z",
    "completedAt": "2024-01-01T00:00:01.000Z",
    "currentStepIndex": 0,
    "totalSteps": 1,
    "replansCount": 0,
    "intent": "image_generate",
    "evidence": [...],
    "artifacts": [
      {
        "artifactId": "uuid",
        "type": "image",
        "mimeType": "image/png",
        "path": "/path/to/file.png",
        "sizeBytes": 1024,
        "createdAt": "2024-01-01T00:00:01.000Z"
      }
    ]
  }
}
```

**Example:**
```bash
curl http://localhost:5000/api/registry/workflows/{runId}
```

### Stream Workflow Events (SSE)

**GET** `/api/registry/workflows/:runId/events`

Server-Sent Events stream for real-time updates.

**Events:**
```
event: run_started
data: {"eventId":"uuid","runId":"uuid","eventType":"run_started","timestamp":"...","data":{...}}

event: step_started
data: {"eventId":"uuid","runId":"uuid","eventType":"step_started","timestamp":"...","stepIndex":0,"toolName":"image_generate"}

event: artifact_created
data: {"eventId":"uuid","runId":"uuid","eventType":"artifact_created","timestamp":"...","data":{"artifact":{...}}}

event: run_completed
data: {"eventId":"uuid","runId":"uuid","eventType":"run_completed","timestamp":"...","data":{...}}
```

**Example:**
```bash
curl -N http://localhost:5000/api/registry/workflows/{runId}/events
```

### Cancel Workflow

**POST** `/api/registry/workflows/:runId/cancel`

Cancel a running workflow.

**Request:**
```json
{
  "reason": "User requested cancellation"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Run {runId} cancelled"
}
```

## Artifact Endpoints

### Download Artifact

**GET** `/api/artifacts/:filename/download`

Download an artifact file.

**Example:**
```bash
curl -O http://localhost:5000/api/artifacts/image_xxx.png/download
```

### Preview Artifact

**GET** `/api/artifacts/:filename/preview`

Preview an artifact (images, PDFs, HTML).

**Example:**
```bash
curl http://localhost:5000/api/artifacts/image_xxx.png/preview
```

## Intent Classification

### Classify Intent

**POST** `/api/registry/classify-intent`

Classify a query's intent.

**Request:**
```json
{
  "query": "crea una imagen de un perro"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "crea una imagen de un perro",
    "intent": "image_generate",
    "isGenerationIntent": true
  }
}
```

## Example Workflows

### Image Generation

```bash
# 1. Start workflow
curl -X POST http://localhost:5000/api/registry/workflows \
  -H "Content-Type: application/json" \
  -d '{"query":"crea una imagen de un gato"}' > /tmp/run.json

RUN_ID=$(cat /tmp/run.json | jq -r '.runId')

# 2. Poll for completion
curl http://localhost:5000/api/registry/workflows/$RUN_ID

# 3. Download artifact
FILENAME=$(curl http://localhost:5000/api/registry/workflows/$RUN_ID | jq -r '.data.artifacts[0].path' | xargs basename)
curl -O http://localhost:5000/api/artifacts/$FILENAME/download
```

### PPT Generation

```bash
curl -X POST http://localhost:5000/api/registry/workflows \
  -H "Content-Type: application/json" \
  -d '{"query":"genera una presentación sobre inteligencia artificial"}'
```

### DOCX Generation

```bash
curl -X POST http://localhost:5000/api/registry/workflows \
  -H "Content-Type: application/json" \
  -d '{"query":"crea un documento word sobre machine learning"}'
```

### XLSX Generation

```bash
curl -X POST http://localhost:5000/api/registry/workflows \
  -H "Content-Type: application/json" \
  -d '{"query":"crea un excel con datos de ventas"}'
```

### PDF Generation

```bash
curl -X POST http://localhost:5000/api/registry/workflows \
  -H "Content-Type: application/json" \
  -d '{"query":"genera un pdf con el resumen del proyecto"}'
```

## Event Log Examples

### Successful Run

```
run_started → step_started → tool_called → tool_output → artifact_created → step_completed → run_completed
```

### Failed Run

```
run_started → step_started → tool_called → tool_output (error) → step_completed (failed) → run_failed
```

### Timeout Run

```
run_started → step_started → ... (30s timeout) → timeout_error → run_failed
```

## Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 202 | Accepted (workflow started) |
| 400 | Bad request (missing query) |
| 404 | Run or artifact not found |
| 500 | Internal server error |
