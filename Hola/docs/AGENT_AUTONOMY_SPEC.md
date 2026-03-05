# IliaGPT — Autonomous Agent (Work) v1 Spec

**Goal:** IliaGPT can take a user request (chat), produce a multi-step plan, execute tools safely (permissions + confirmation), and return a clear report. Target use-case: **Work productivity** (Gmail + Calendar + Docs + Web).

## Core components

### 1) Intent Router
- Input: user message + attachments + chat/workspace context
- Output: `intent`, `confidence`, extracted entities
- v1 intents:
  - Gmail: `gmail_search`, `gmail_fetch`, `gmail_send`, `gmail_mark_read`
  - Calendar: `calendar_list`, `calendar_create`, `calendar_move`
  - Docs: `docs_search`, `docs_summarize`, `docs_export`
  - Web: `web_search`, `browse_url`

### 2) Planner / Runner
- Loop: **Plan → Execute steps → Report**
- Persist `runId`, steps, tool calls, errors, retries
- Idempotency: avoid duplicate side effects (especially email send)

### 3) Tool Executor + Policy
All tool calls go through:
1. **Permission check** (workspace/user/role)
2. **Policy engine** (confirmation required, limits)
3. **Idempotency** (per tool call)
4. **Audit logs** (traceId/runId/tool)

## Confirmation policy (v1)
**Always ask for confirmation** before:
- Sending emails (`gmail_send`)
- Mass mailbox actions (future: archive/delete bulk)
- Inviting attendees / creating external meetings (calendar)
- Sharing docs externally

**No confirmation required** for:
- Listing/searching/reading/summarizing
- Preparing drafts

## Minimal API surface (aliases)
- `POST /api/agent/runs` start an agent run
- `GET /api/agent/runs/chat/:chatId` check latest run state
- `GET /api/runs/:runId` generic run status (existing)

## Notes
- Gmail tools are implemented in `server/integrations/gmailApi.ts` and exposed to the agent via `server/agent/extendedTools.ts`.
- Calendar tools are planned; current calendar integration is not yet wired to real provider APIs.
