# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### UI/UX
The frontend utilizes React with TypeScript and Vite, employing shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode. Key UI/UX features include chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, a unified workspace, and an AI quality system with Sources/Fuentes citation. Content support covers Markdown, code highlighting (Monaco Editor), and mathematical expressions. Data visualization is handled by Recharts, ECharts, and TanStack Table, with a multi-layer graphics rendering system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js). Performance optimizations include message virtualization, memoization, lazy loading, streaming UX, exponential backoff, offline queuing, and robust error handling. Security and accessibility are addressed through DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support.

### Technical Implementation
The backend is built with Node.js and Express.js. An LLM Gateway manages AI model interactions with features like multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, and response caching. An ETL Agent automates economic data processing and generates ZIP bundles with Excel workbooks and audit reports. The system incorporates a Multi-Intent Pipeline for complex user prompts and a PARE System (Prompt Analysis & Routing Engine) for production-grade document processing across various formats (PDF, DOCX, XLSX, PPTX, CSV, TXT), including per-document citations and a defense-in-depth architecture. A Document Generation System uses LLM orchestration to create Excel and Word files, including professional CV/Resume generation. The Spreadsheet Analyzer Module offers AI-powered analysis, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox.

The core Agent Infrastructure features a modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers. A Tool Registry provides 103 agent tools across 21 categories with standardized outputs and sandboxed execution. Specialized Agents include 10 dedicated specialists for orchestration, research, code, data, content, communication, browsing, document handling, QA, and security. Agent planning is organized into phases (Research → Planning → Execution → Verification → Delivery). The WebTool Module offers a layered architecture for web navigation, including URL canonicalization, content deduplication, and sandbox security, supported by an Ultra-Fast Web Retrieval System.

Agent Orchestration employs a Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles. Agent Mode features include event stream tracking, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention. A robust Agent Cancellation System is implemented. A Router System intelligently routes messages between chat and agent modes. The AgentRunner provides a simplified agent loop with heuristic fallback and guardrails. Sandbox Agent V2 offers a comprehensive TypeScript agent system with phase-based execution and secure operations. A standalone Python Agent v5.0 includes tools, multi-level caching, and security features.

An enterprise-grade LangGraph Agent System uses StateGraph for workflow management, supervisor and reflection patterns, human-in-the-loop approvals, PostgreSQL checkpoint persistence, and conversation memory. The Agentic Orchestration Pipeline includes PromptAnalyzer, IntentRouter, SupervisorAgent, AgentLoopFacade, ActivityStreamPublisher (SSE streaming), and a comprehensive Memory System for execution context. The Conversation Memory System provides server-side persistence for conversation state in PostgreSQL with Redis caching, versioned state management, artifact deduplication, and image edit chain tracking, exposed via a REST API and frontend hook.

A GPT Session Contract System provides immutable session-based GPT configurations. Key features: (1) Session contracts are created per GPT + chat combination and frozen at creation time, stored in `gpt_sessions` table with Zod schema validation; (2) Backend is fully authoritative for system_prompt, model, tool permissions, capabilities, and knowledge base - client cannot override; (3) Model enforcement with `runtimePolicy.enforceModel` defaults to strict mode, falling back to DEFAULT_MODEL when no specific model is configured; (4) Tool permissions use allowlist/denylist modes with per-session frozen settings; (5) Frontend saves and reuses `session_id` from responses for session persistence; (6) New chat or GPT switch resets the session. The session service (`gptSessionService.ts`) provides `createGptSession`, `getOrCreateSession`, `getSessionById`, `isToolAllowed`, `getEnforcedModel`, and `buildSystemPromptWithContext` functions.

A Python Agent Tools System (FastAPI microservice) provides 30+ tools across 11 categories with a StateManager, WorkflowEngine, WebSocket support, rate limiting, and security headers. The Tool Execution Engine (TypeScript) offers a unified interface for executing both Python and TypeScript tools, with automatic discovery, circuit breaker patterns, execution history tracking, real-time progress streaming, caching, and health checks. A Python Service Manager handles the lifecycle of the Python Agent Tools service. An Enhanced AI Excel Router provides production-grade Excel AI operations with Zod validation, rate limiting, extended data generation, formula generation, and SSE streaming. New API Endpoints (`/api/execution/*`, `/api/python-tools/*`, `/api/ai/excel/*`) support tool execution, Python tools proxy, and enhanced Excel AI operations.

### Infrastructure
Security is implemented with bcrypt password hashing, multi-tenant validation, authentication middleware, max iterations/timeout for agent runs, and production-grade security headers (CSP, HSTS). Safe process execution is ensured through centralized modules (`safe_exec.py`, `safeSpawn.ts`) with program allowlists and argument validation. Package installation security uses `execFile` with minimal environments. SQL security for the admin query explorer includes SELECT-only validation and audit logging. Modular repositories with ownership validation and transaction helpers are used. Custom error classes and global Express error handling are in place, alongside Zod validation middleware for APIs. Database performance is optimized with indices.

### Scalability & Performance
Enterprise-grade scalability and performance are achieved through Redis SSE Streaming for horizontal scaling, a Memory Cache Layer (LRU with optional Redis backend), Response Caching Middleware with ETag support, and Request Deduplication. Compression Middleware handles Gzip and Brotli. Circuit Breakers wrap external services with configurable timeouts and retries. Rate Limiting uses a sliding window algorithm. Graceful Shutdown ensures connection draining and WebSocket cleanup. A FastAPI SSE Backend provides a production-grade Python SSE microservice for agent tracing using Redis Streams, consumer groups, backpressure handling, token bucket rate limiting, optional authentication, Celery workers, circuit breakers, OpenTelemetry tracing, and health endpoints.

### Production Robustness Systems
The following production-grade systems ensure stability under high load:

**Large Document Processor** (`server/lib/largeDocumentProcessor.ts`): Handles documents with 500k+ tokens via intelligent chunking (50k token max with semantic boundaries), streaming processing with AsyncGenerator, backpressure control (pauses at 80% heap usage), concurrency limiting via semaphore (3 concurrent), and memory limits (512MB default). Includes 26 Vitest tests for validation.

**Dialogue Manager FSM** (`server/pipeline/dialogueManager.ts`): Corrected state machine with proper transitions (clarifying→clarifying allowed), state timeouts (30s), session cleanup for inactivity (1hr), and context reset on state changes.

**Stage Watchdog with AbortController** (`server/pipeline/stageTimeouts.ts`): Real timeout propagation via AbortController per stage, abort signal chaining to downstream operations, and proper cleanup in finishRequest().

**Memory Leak Prevention** (`server/agent/superAgent/tracing/RunController.ts`, `EventStore.ts`): Automatic cleanup of completed runs (5min timeout), buffer eviction (10k max events), proactive GC (60s intervals), and WeakRef-based instance tracking.

**Tenant-Isolated Circuit Breaker** (`server/lib/circuitBreaker.ts`): Per (tenant, provider) isolation, 5-state FSM (CLOSED/OPEN/HALF_OPEN), LRU eviction (10k max breakers), and automatic cleanup of stale breakers.

**PostgreSQL Health Checks** (`server/db.ts`): Proactive checks every 30s, 3-state health (HEALTHY/DEGRADED/UNHEALTHY), exponential backoff reconnection (1s→30s), and Prometheus metrics (db_health_status, db_query_latency_ms, db_connection_failures_total).

**EventStore Batch Inserts** (`server/agent/superAgent/tracing/EventStore.ts`): UNNEST-based batch INSERT for performance, transactions with retry (3 attempts, 100ms→400ms backoff), and grouping by run_id.

**Connection Heartbeat Manager** (`server/lib/connectionHeartbeat.ts`): 15s heartbeat intervals, zombie detection (3 missed beats), automatic cleanup, and SSE/WebSocket protocol support.

**Context Compressor** (`server/lib/contextCompressor.ts`): 70% compression target via 4 strategies (summarization, deduplication, pruning, semantic clustering), 1hr summary cache, and preserves last 5 messages intact.

**Semantic Cache** (`server/lib/semanticCache.ts`): Embedding-based similarity (0.92 threshold), LSH indexing for fast lookup, LRU eviction (10k entries), and batch embedding operations.

**Graceful Degradation** (`server/lib/gracefulDegradation.ts`): 5 degradation levels (FULL→OFFLINE), fallback chains for LLM/DB/embeddings, automatic recovery when services heal, and Prometheus metrics.

**Self-Healing System** (`server/lib/selfHealing.ts`): Automatic error diagnosis (transient/config/dependency/code_bug), healing actions (RETRY/RESTART/CLEAR_CACHE/RESET_CONNECTION/FALLBACK/ESCALATE), pattern detection (>3 errors in 5min), and escalation for unrecoverable errors.

**OpenTelemetry Distributed Tracing** (`server/lib/tracing.ts`): TracerProvider with BatchSpanProcessor, auto-instrumentation (HTTP/Express/PostgreSQL), custom spans for LLM/DB/agent/pipeline operations, and 10% sampling in production.

**Output Sanitizer** (`server/lib/outputSanitizer.ts`): PII detection (8 types: email, phone, SSN, credit cards with Luhn, names, addresses, DOB, tax IDs), secret detection (8 types: API keys, AWS keys, passwords, JWT, private keys, connection strings, OAuth tokens), and configurable actions (REDACT/MASK/BLOCK/LOG).

**Backtracking Manager** (`server/lib/backtracking.ts`): Automatic checkpoints at key points, state restoration to last valid checkpoint, re-planning with failure avoidance constraints, and maximum 3 backtrack attempts.

### Data Storage
PostgreSQL is used as the relational database, managed with Drizzle ORM. Client-side persistence leverages `localStorage` for chat history and preferences, and IndexedDB for background tasks and the offline queue.

### Key Design Patterns
The project utilizes a monorepo structure (`client/`, `server/`, `shared/`) and ensures type safety through Zod schemas for runtime validation.

## External Dependencies
### AI Services
- **xAI Grok API**: Primary AI model provider (e.g., `grok-3-fast`, `grok-4-1-fast-non-reasoning`).
- **Google Gemini API**: Default AI model provider (e.g., `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`).
- **LangGraph + LangChain**: Agent orchestration framework for stateful, multi-step workflows.

### Database
- **PostgreSQL**: Relational database for persistent storage.
- **Drizzle Kit**: For database schema migrations.

### CDN Resources
- **KaTeX**: For rendering mathematical expressions.
- **Highlight.js**: For code syntax highlighting themes.
- **Google Fonts**: Custom font families.

### External APIs
- **Piston API**: For multi-language code execution.
- **World Bank API V2**: For economic data retrieval.
- **Gmail API**: For Gmail chat integration.