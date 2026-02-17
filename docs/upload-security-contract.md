# Upload Security Contract

This document defines the hard requirements for upload endpoints and clients.

## Runtime Contract Endpoint

- `GET /api/objects/security-contract`
- Returns runtime policy for authentication, CSRF, CORS, upload limits, and idempotency headers.
- Response headers:
- `X-Request-Id`
- `X-Correlation-Id` (set globally by middleware)

## Authentication Models

1. Stateful auth (`cookie-session`)
- CSRF is required for state-changing upload endpoints.
- Client must call `GET /api/csrf/token` when token is missing or stale.
- Client must send:
- `credentials: "include"`
- `X-CSRF-Token` (and alias `X-CSRFToken` accepted)
- Cookies should be configured for cross-site use when needed (`SameSite=None`, `Secure`).

2. Stateless auth (`bearer-token`)
- CSRF is not required.
- Upload endpoints are protected by bearer/API-key auth and rate limits.
- Client should omit CSRF enforcement when runtime contract says `csrf.required = false`.

## Idempotency and Isolation

- `X-Upload-Id` and `X-Conversation-Id` are accepted in headers and body.
- Header/body values must match when both are present, otherwise request is rejected (`409`).
- `uploadId` re-use with conflicting payload/fingerprint is rejected (`409`).
- Conversation/file isolation is enforced by scoped idempotency keys.

## File Intent Validation

- Endpoint: `POST /api/objects/upload`
- Optional metadata:
- `fileName`
- `mimeType`
- `fileSize`
- If metadata is present, all fields must be valid.
- Enforced checks:
- MIME allowlist
- Max size
- Filename extension and MIME consistency
- Unicode filename normalization (`NFKC`)

## Multipart Upload Rules

- Endpoints:
- `POST /api/objects/multipart/create`
- `POST /api/objects/multipart/sign-part`
- `POST /api/objects/multipart/complete`
- `POST /api/objects/multipart/abort`
- Completion requires full ordered part list (`1..totalChunks`).
- Incomplete/missing part sequences are rejected.

## Client Transport Rules

- Do not set manual `Content-Type` for presigned `PUT` uploads when uploading raw blobs/files.
- Use retry with exponential backoff + jitter for:
- upload-intent request
- upload execution
- file registration
- Enforce hard timeout and abort support to prevent infinite loading states.

## Processing Status

- After registration, file status transitions:
- `queued` -> `processing` -> `ready`
- Failure states:
- `failed` or `error`
- User-facing errors should include actionable reason and (when available) request identifier.
- Polling endpoint:
- `GET /api/files/:id/status`
- Ownership is enforced per actor (`userId`/anon/API key scope).
- Response shape:
- `fileId`
- `status`
- `processingProgress`
- `processingError`
- `completedAt`
- Realtime fallback:
- WebSocket status subscriptions must degrade to polling when auth/socket fails.
