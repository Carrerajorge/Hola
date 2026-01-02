# Sira GPT

## Overview
Sira GPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation, with ambitions to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
- **Frameworks**: React with TypeScript and Vite.
- **UI/UX**: Utilizes shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode.
- **Content Rendering**: Supports Markdown, code highlighting (Monaco Editor), and mathematical expressions.
- **Data Visualization**: Employs Recharts, ECharts, and TanStack Table for interactive data representation.
- **Graphics Rendering**: A multi-layer system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js).
- **Productivity & Enterprise Features**: Includes chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, unified workspace, and an AI quality system.
- **Performance & Resilience**: Implements message virtualization, memoization, lazy loading, streaming UX indicators, exponential backoff, offline queuing, and error handling.
- **Security & Accessibility**: Features DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support.

### Backend
- **Runtime**: Node.js with Express.js.
- **LLM Gateway**: Manages AI model interactions with features like multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, rate limiting, and response caching.
- **ETL Agent**: Automates economic data processing and generates ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts through defined stages (Plan, Decompose, Execute, Aggregate).
- **Document Generation System**: Generates Excel and Word files based on Zod schemas, using LLM orchestration with repair loops.
- **Professional CV/Resume Generation**: A three-layer architecture for structured CV generation.
- **Spreadsheet Analyzer Module**: Provides AI-powered analysis, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox for execution.
- **System Observability**: Features structured JSON logging with correlation IDs, health monitoring, and request tracing.
- **Agent Infrastructure (Hardened)**: Modular plugin architecture with:
  - **StateMachine**: Explicit state transitions for runs (queued→planning→running→verifying→completed/failed/cancelled/paused) and steps with transition validation
  - **Typed Contracts**: Zod schemas for Run, Step, ToolCall, Artifact with runtime validation
  - **Event Sourcing**: Append-only agent_events table with correlationId tracking, audit fields (input_hash, output_ref, duration_ms, error_code, retry_count)
  - **PolicyEngine**: RBAC with plan-based permissions (free/pro/admin), deny-by-default for sensitive tools, rate limiting
  - **ExecutionEngine**: Circuit breaker (5 failures→open, 60s reset), exponential backoff with jitter, cancellation tokens, configurable timeouts
  - **ToolRegistry**: 5 registered tools (analyze_spreadsheet, web_search, generate_image, browse_url, generate_document) with capabilities and standardized outputs (artifacts[], previews[], logs[], metrics[])

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

## Agent Mode - Acceptance Checklist

### Core Functionality
- [x] Chat normal funciona sin cambios (Agent es plugin modular)
- [x] Botón Agente activa mode='agent' en mensajes
- [x] Panel Plan/Progreso/Artefactos visible en UI

### State Machine & Contracts
- [x] Máquina de estados estricta: queued→planning→running→verifying→completed/failed/cancelled/paused
- [x] Contratos tipados con Zod: Run, Step, ToolCall, Artifact
- [x] Validación runtime de transiciones de estado
- [x] Idempotency keys en agent_runs

### Persistence & Events
- [x] Tablas PostgreSQL: agentModeRuns, agentModeSteps, agentModeEvents
- [x] Índices por chatId, messageId, runId, status, createdAt
- [x] Event sourcing append-only con correlationId
- [x] Campos de auditoría: inputHash, outputRef, durationMs, errorCode, retryCount

### Execution Engine
- [x] Circuit breaker (5 failures→open, 60s reset)
- [x] Backoff exponencial con jitter para reintentos
- [x] Cancel tokens para abortar ejecución
- [x] Timeouts configurables por herramienta

### Tool Registry
- [x] 5 herramientas registradas: analyze_spreadsheet, web_search, generate_image, browse_url, generate_document
- [x] Outputs normalizados: {artifacts[], previews[], logs[], metrics[]}
- [x] Métricas por ejecución: latencyMs, tokensUsed

### Policy Engine
- [x] RBAC por plan: free, pro, admin
- [x] Deny-by-default para herramientas sensibles
- [x] Rate limiting por usuario/herramienta
- [x] Capacidades por herramienta (requiresConfirmation, isDestructive, etc.)

### API Endpoints
- [x] POST /api/agent/runs - Crear run
- [x] GET /api/agent/runs/:id - Obtener run
- [x] GET /api/agent/runs/:id/steps - Obtener steps
- [x] GET /api/agent/runs/:id/events - Obtener eventos
- [x] POST /api/agent/runs/:id/cancel - Cancelar run
- [x] POST /api/agent/runs/:id/retry - Reintentar run fallido
- [x] POST /api/agent/runs/:id/pause - Pausar run activo
- [x] POST /api/agent/runs/:id/resume - Resumir run pausado

### Observability
- [x] Logs estructurados con correlationId
- [x] Métricas por step: latency, success_rate, tool_error_rate
- [x] MetricsCollector con getLatencyP95, getSuccessRate, getErrorRate

### Tests
- [x] Unit tests para StateMachine (18 tests)
- [x] Unit tests para ToolRegistry (7 tests)
- [x] Unit tests para PolicyEngine (16 tests)
- [x] Unit tests para MetricsCollector (13 tests)
- [x] Tests ubicados en server/agent/__tests__/agent.test.ts

### Hardening (Defensive Programming)
- [x] Validación Zod estricta en todos los límites (server/agent/validation.ts)
- [x] TransitionGuards para transiciones de estado bloqueadas (stateMachine.ts)
- [x] Idempotency keys y deduplicación (server/agent/idempotency.ts)
- [x] Transacciones DB + locks optimistas (server/agent/dbTransactions.ts)
- [x] Cancel tokens con ResourceCleanupRegistry (executionEngine.ts)
- [x] Sandbox Security deny-by-default (server/agent/sandboxSecurity.ts)
- [x] EventTracer para observabilidad completa (metricsCollector.ts)

### Chaos Tests & Benchmarks
- [x] 39 chaos tests cubriendo resiliencia, circuit breaker, edge cases
- [x] 5 benchmarks de rendimiento con umbrales
- [x] State Machine: 1000 transiciones < 100ms
- [x] Metrics: 10000 registros < 200ms
- [x] Tool Registry: 100 calls concurrentes < 500ms
- [x] Memory: < 50MB para 10000 eventos

### Evidence
- **Test command**: `npx vitest run server/agent/__tests__`
- **125 tests passing** verificando toda la infraestructura del Agent
- **Archivos creados**: validation.ts, idempotency.ts, dbTransactions.ts, sandboxSecurity.ts, chaos.test.ts, benchmarks.test.ts

## Certification Pipeline

### Scripts
- `npm run agent:certify` - Ejecuta pipeline completo de certificación
- `npm run agent:release-gate` - Verifica que certificación esté vigente antes de deploy

### Pipeline Stages
1. **Unit/Integration/Chaos/Benchmark Tests** - Ejecuta 125 tests en server/agent/__tests__
2. **Static Validation (Agent)** - Verifica archivos del módulo Agent solamente
3. **Soak Test** - 1min con 10 runs concurrentes, éxito >99.5%, P95 <200ms
4. **Production Build** - npm run build sin errores

### Auto-Fix System
- Máximo 3 intentos por certificación
- Diagnósticos automáticos para tests fallidos, errores de tipos, soak test
- Reintentos con backoff entre intentos

### Release Gates (scripts/release-gate.cjs)
- Bloquea deploy si reporte no existe
- Bloquea si reporte es más viejo que 24 horas
- Bloquea si status no es PASSED

### Report Output
- Ubicación: `test_results/agent_certification_report.md`
- Métricas: P95/P99 latency, throughput, memory peak, flakiness
- Detalles por stage con duración y errores

### Certification Status (Latest)
- **Date**: 2026-01-02
- **Status**: PASSED
- **Duration**: ~121s total (8s tests, 8s validation, 60s soak, 45s build)
- **Success Rate**: 100%
- **P95 Latency**: 207ms

## WebTool Module (Production-Grade)

### Architecture
Layered architecture for web navigation and information retrieval:
- **SearchAdapter**: Wraps web search with normalized results
- **FetchAdapter**: HTTP fetch with retries, timeouts, robots.txt respect, sandbox security
- **BrowserAdapter**: Playwright-based for JavaScript-rendered pages with wait strategies
- **RetrievalPipeline**: Orchestrates adapters with canonicalization, deduplication, scoring, extraction

### Features
- **URL Canonicalization**: Removes 50+ tracking params (utm_*, fbclid, gclid, etc.)
- **Content Deduplication**: By canonical URL and SHA256 content hash
- **Quality Scoring**: Domain allowlist, TLD scoring, HTTPS bonus, recency, authoritativeness
- **Content Extraction**: Readability-based with ExtractedDocument structure (title, headings, links, wordCount, readTime, language)
- **Sandbox Security**: All adapters check host allowlist before network access
- **Cancellation Support**: CancellationToken integration for graceful abort

### Files
- `server/agent/webtool/types.ts` - Zod schemas and TypeScript types
- `server/agent/webtool/canonicalizeUrl.ts` - URL normalization with validation
- `server/agent/webtool/hashContent.ts` - SHA256 content hashing
- `server/agent/webtool/qualityScorer.ts` - Configurable quality scoring
- `server/agent/webtool/searchAdapter.ts` - ISearchAdapter + DuckDuckGoSearchAdapter
- `server/agent/webtool/fetchAdapter.ts` - IFetchAdapter + HttpFetchAdapter
- `server/agent/webtool/browserAdapter.ts` - IBrowserAdapter + PlaywrightBrowserAdapter
- `server/agent/webtool/retrievalPipeline.ts` - RetrievalPipeline orchestrator

### Tool Registration
- **Tool**: `web_search_retrieve`
- **Capabilities**: requires_network, accesses_external_api, long_running

### Tests
- **170 tests** covering all components
- Test file: `server/agent/__tests__/webtool.test.ts`