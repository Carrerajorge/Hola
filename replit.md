# Sira GPT

## Overview
Sira GPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation, with ambitions to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
- **Frameworks**: React with TypeScript and Vite.
- **UI/UX**: Utilizes shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode. Features include chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, unified workspace, and an AI quality system.
- **Content Rendering**: Supports Markdown, code highlighting (Monaco Editor), and mathematical expressions.
- **Data Visualization**: Employs Recharts, ECharts, and TanStack Table for interactive data representation.
- **Graphics Rendering**: A multi-layer system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js).
- **Performance & Resilience**: Implements message virtualization, memoization, lazy loading, streaming UX indicators, exponential backoff, offline queuing, and error handling.
- **Security & Accessibility**: Features DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support.

### Backend
- **Runtime**: Node.js with Express.js.
- **LLM Gateway**: Manages AI model interactions with features like multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, rate limiting, and response caching.
- **ETL Agent**: Automates economic data processing and generates ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts through defined stages (Plan, Decompose, Execute, Aggregate).
- **Document Generation System**: Generates Excel and Word files based on Zod schemas, using LLM orchestration with repair loops, including a dedicated system for professional CV/Resume generation.
- **Spreadsheet Analyzer Module**: Provides AI-powered analysis, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox for execution.
- **System Observability**: Features structured JSON logging with correlation IDs, health monitoring, and request tracing.
- **Agent Infrastructure**: Modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers and exponential backoff.
- **Tool Registry**: Registers 5 core tools: `analyze_spreadsheet`, `web_search`, `generate_image`, `browse_url`, `generate_document`, with standardized outputs.
- **WebTool Module**: Layered architecture for web navigation and information retrieval, including SearchAdapter, FetchAdapter, BrowserAdapter, and RetrievalPipeline. Features URL canonicalization, content deduplication, quality scoring, content extraction, and sandbox security.
- **Ultra-Fast Web Retrieval System**: High-performance web retrieval with parallel execution, intelligent caching (in-memory, LRU), relevance filtering, and streaming results.

### Infrastructure
- **Security**: Password hashing with bcrypt and multi-tenant validation.
- **Modular Repositories**: Generic base repository with ownership validation and transaction helpers.
- **Error Handling**: Custom error classes and global Express error handler.
- **API Validation**: Zod validation middleware for requests.
- **Database Performance**: Optimized indices for frequently queried fields.

### Data Storage
- **Database**: PostgreSQL, managed with Drizzle ORM.
- **Client-side Persistence**: `localStorage` for chat history/preferences, IndexedDB for background tasks and offline queue.

### Key Design Patterns
- **Monorepo Structure**: Organized into `client/`, `server/`, `shared/` directories.
- **Type Safety**: Achieved through Zod schemas for runtime validation.

## External Dependencies
### AI Services
- **xAI Grok API**: Primary AI model provider (e.g., `grok-3-fast`, `grok-2-vision-1212`) via OpenAI-compatible SDK.
- **Google Gemini API**: Default AI model provider (e.g., `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`) via `@google/genai` SDK.

### Database
- **PostgreSQL**: Relational database for persistent storage.
- **Drizzle Kit**: Used for database schema migrations.

### CDN Resources
- **KaTeX**: For rendering mathematical expressions.
- **Highlight.js**: Provides code syntax highlighting themes.
- **Google Fonts**: Custom font families (Geist, Inter).

### External APIs
- **Piston API**: Used for multi-language code execution.
- **World Bank API V2**: Integrated for economic data retrieval by the ETL Agent.
- **Gmail API**: Utilized for Gmail chat integration.

## Web Retrieval Production Readiness

### Pipeline Architecture
```
User Prompt → RetrievalPlanner → ConcurrencyPool → FastFirstPipeline
                                                        ↓
                                    ResponseCache ←→ FetchAdapter (3s)
                                         ↓              ↓ (fallback)
                                    RelevanceFilter ← BrowserAdapter (8s)
                                         ↓
                                    RetrievalMetrics → Admin Endpoint
```

### Tuning Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `fetchTimeoutMs` | 3000 | HTTP fetch timeout |
| `browserTimeoutMs` | 8000 | Browser render timeout |
| `maxConcurrency` | 6 | Parallel fetch limit |
| `maxMemoryMb` | 50 | Cache memory cap |
| `maxContentSizeBytes` | 1MB | Max cached entry |

### SLO Compliance

| Metric | Threshold | Fast Mode | Realistic Mode |
|--------|-----------|-----------|----------------|
| Fetch P95 | ≤3000ms | 48.9ms | 1876.9ms |
| Browser P95 | ≤8000ms | N/A | 4969.9ms |
| Total P95 | - | 64.7ms | 5648.3ms |
| Success Rate | ≥95% | 97.94% | 97.36% |

### Test Summary

| Test | Count | Status |
|------|-------|--------|
| Agent Tests | 408 | ✅ |
| Chaos Tests | 33 | ✅ |
| Isolation Tests | 26 | ✅ |
| Benchmarks | 13 | ✅ |

### Multi-Instance Cache

**Status**: In-memory per instance. Redis NOT required because:
1. Stateless design - cache miss fetches fresh content
2. Short TTLs (5-10 min) - stale data auto-evicts
3. 50MB cap per instance within container limits

### Tenant Isolation

Cache keys prefixed with `t:{hashedTenantId}:`. Tenant IDs hashed (SHA-256, 12 chars) for PII protection.

### Admin Endpoint Security

`GET /api/admin/retrieval-status?window=<ms>`
- **RBAC**: Admin-only via `isAuthenticated` + `requireAdmin` middleware
- **Window Validation**: Clamped to 1 min - 24 hours (prevents DoS)
- **PII Redaction**: Domains hashed in `topErrorDomains`
- **Logs Sanitized**: No URLs/headers in error logs

### Reproduction Commands

```bash
# All tests (408)
npx vitest run server/agent/__tests__

# Benchmarks
npx tsx scripts/web-bench.ts

# Soak test - fast mode (duration in SECONDS)
npx tsx scripts/soak-test.ts --concurrency 100 --duration 60

# Soak test - realistic latencies
npx tsx scripts/soak-test.ts --concurrency 50 --duration 30 --realistic
```