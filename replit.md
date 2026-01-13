# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### UI/UX
- **Frontend**: React with TypeScript and Vite, utilizing shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode.
- **Features**: Chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, unified workspace, AI quality system, and Sources/Fuentes citation system.
- **Content Support**: Markdown, code highlighting (Monaco Editor), and mathematical expressions.
- **Data Visualization**: Recharts, ECharts, and TanStack Table.
- **Graphics Rendering**: Multi-layer system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js).
- **Performance**: Message virtualization, memoization, lazy loading, streaming UX, exponential backoff, offline queuing, and error handling.
- **Security & Accessibility**: DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support.

### Technical Implementation
- **Backend**: Node.js with Express.js.
- **LLM Gateway**: Manages AI model interactions with multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, rate limiting, and response caching.
- **ETL Agent**: Automates economic data processing and generates ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts through defined stages (Plan, Decompose, Execute, Aggregate).
- **PARE System (Prompt Analysis & Routing Engine)**: Production-grade document processing with a defense-in-depth architecture supporting various formats (PDF, DOCX, XLSX, PPTX, CSV, TXT) with per-document citations. Includes robust request validation, sandboxing, circuit breakers, and comprehensive observability (OpenTelemetry tracing, Prometheus metrics, Kubernetes health probes, structured JSON logging).
- **Document Generation System**: Generates Excel and Word files using LLM orchestration with repair loops, including professional CV/Resume generation.
- **Spreadsheet Analyzer Module**: AI-powered analysis, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox for execution.
- **Agent Infrastructure**: Modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers and exponential backoff.
- **Tool Registry**: Production-grade registry with 103 agent tools across 21 categories, standardized outputs, and sandboxed execution, covering orchestration, memory, reasoning, communication, system, research, web automation, generation, processing, data, documents, development, diagrams, API, productivity, security, automation, database, monitoring, and utility.
- **Specialized Agents**: Production-grade agent system with 10 dedicated specialists including OrchestratorAgent, ResearchAgent, CodeAgent, DataAgent, ContentAgent, CommunicationAgent, BrowserAgent, DocumentAgent, QAAgent, and SecurityAgent.
- **Phase-Based Planning**: Agent plans organized into logical phases (Research → Planning → Execution → Verification → Delivery).
- **WebTool Module**: Layered architecture for web navigation and information retrieval with URL canonicalization, content deduplication, quality scoring, content extraction, and sandbox security.
- **Ultra-Fast Web Retrieval System**: High-performance web retrieval with parallel execution, intelligent caching, relevance filtering, and streaming results.
- **Agent Orchestration**: Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles.
- **Agent Mode Features**: Event stream tracking, todo.md tracking, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention in context for learning.
- **Agent Cancellation System**: Robust cancellation with AbortController/CancellationToken propagation.
- **Router System**: Hybrid decision system to route messages between chat and agent mode using heuristic patterns, complexity analysis, and LLM routing.
- **AgentRunner**: Simplified agent loop for executing multi-step tasks with heuristic fallback, event emission, configurable max steps, and guardrails.
- **Sandbox Agent V2**: Comprehensive TypeScript agent system with phase-based execution, automatic task decomposition, and secure sandboxed operations.
- **Python Agent v5.0**: Standalone Python-based agent system with tools, multi-level caching, per-domain rate limiting, browser pool, security guard, and pattern-based intent detection.
- **LangGraph Agent System**: Enterprise-grade agent orchestration using the LangGraph framework with StateGraph-based workflow management, supervisor and reflection patterns, human-in-the-loop approvals, PostgreSQL checkpoint persistence, and conversation memory.
- **Agentic Orchestration Pipeline**: Professional multi-agent system including PromptAnalyzer (intent classification, memory hydration), IntentRouter (routes prompts to direct, single_agent, or multi_agent paths), SupervisorAgent (LangGraph orchestrator for parallel execution, retry logic), AgentLoopFacade (main pipeline composer), ActivityStreamPublisher (SSE streaming for real-time UI updates), and a comprehensive Memory System for persisting and hydrating execution context.
- **Conversation Memory System**: Production-grade server-side persistence for conversation state with:
  - PostgreSQL tables: `conversation_states`, `conversation_messages`, `conversation_artifacts`, `conversation_images`, `conversation_contexts`, `conversation_state_versions`
  - Redis cache layer with automatic fallback to in-memory Map when unavailable
  - Versioned state management with snapshot/restore capabilities for rollback
  - Artifact deduplication by SHA-256 checksum
  - Image edit chain tracking (parent→child relationships for edits)
  - Transactional message insertion with sequence locking to prevent race conditions
  - REST API at `/api/memory/chats/:chatId/...` for hydrate/append/snapshot operations
  - React Query-based frontend hook (`useConversationState`) for seamless state synchronization
  - Automatic image persistence from ProductionWorkflowRunner during agent execution

### Infrastructure
- **Security**: Password hashing with bcrypt, multi-tenant validation, authentication middleware, max iterations/timeout for agent runs.
- **Security Headers Middleware**: Production-grade security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- **Safe Process Execution**: Centralized secure execution modules (`safe_exec.py` for Python, `safeSpawn.ts` for TypeScript) with program allowlists, argument validation, and environment sanitization.
- **Package Installation Security**: Pip and npm package installations use `execFile` with argument arrays and minimal environments.
- **SQL Security**: Admin query explorer uses strict SELECT-only validation with dangerous pattern blocking and comprehensive audit logging.
- **Modular Repositories**: Generic base repository with ownership validation and transaction helpers.
- **Error Handling**: Custom error classes and global Express error handler.
- **API Validation**: Zod validation middleware for requests.
- **Database Performance**: Optimized indices for frequently queried fields.

### Scalability & Performance (Enterprise-Grade)
- **Redis SSE Streaming**: Server-Sent Events with Redis Pub/Sub for horizontal scaling, stateless backend design, session state in Redis.
- **Memory Cache Layer**: LRU cache with optional Redis backend, namespaced caches, cache statistics tracking.
- **Response Caching Middleware**: Caches expensive GET endpoints with ETag support and stale-while-revalidate.
- **Request Deduplication**: Coalesces identical concurrent requests to prevent thundering herd.
- **Compression Middleware**: Gzip and Brotli compression with content-type detection and configurable thresholds.
- **Circuit Breakers**: Wraps external services (LLM APIs) with configurable timeout, retries, and exponential backoff.
- **Rate Limiting**: Sliding window algorithm with per-IP tracking and X-RateLimit headers.
- **Graceful Shutdown**: Connection draining, WebSocket cleanup, and configurable shutdown timeout.
- **FastAPI SSE Backend**: Production-grade Python SSE microservice (`fastapi_sse/`) for agent tracing with:
  - Redis Streams with consumer groups for durability, replay (Last-Event-ID), and at-least-once delivery
  - Backpressure handling with bounded buffers, slow client detection, and write timeouts
  - Token bucket rate limiting (IP/user/route) with Redis backend
  - Optional API key/JWT authentication middleware
  - Celery workers for decoupled agent execution publishing events to streams
  - Circuit breakers for Redis and Celery with graceful degradation (POST /chat fallback)
  - OpenTelemetry tracing/metrics with Prometheus exporter and structured logging
  - Health endpoints (/healthz, /readyz, /metrics)
  - Docker deployment (Dockerfile, docker-compose.yml with Redis + App + Workers + Flower)

### Environment Variables (Production)
- `REDIS_URL`: Redis connection for caching, pub/sub, and session state.
- `SESSION_TTL_SECONDS`: Session expiration time (default: 3600).
- `SSE_HEARTBEAT_INTERVAL`: SSE keepalive interval (default: 15s).
- `SSE_CLIENT_TIMEOUT`: Maximum SSE connection duration (default: 300s).
- `SSE_MAX_QUEUE_SIZE`: Backpressure queue limit (default: 100).

### Data Storage
- **Database**: PostgreSQL, managed with Drizzle ORM.
- **Client-side Persistence**: `localStorage` for chat history/preferences, IndexedDB for background tasks and offline queue.

### Key Design Patterns
- **Monorepo Structure**: Organized into `client/`, `server/`, `shared/` directories.
- **Type Safety**: Achieved through Zod schemas for runtime validation.

## External Dependencies
### AI Services
- **xAI Grok API**: Primary AI model provider (e.g., `grok-3-fast`, `grok-4-1-fast-non-reasoning`) via OpenAI-compatible SDK.
- **Google Gemini API**: Default AI model provider (e.g., `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`) via `@google/genai` SDK.
- **LangGraph + LangChain**: Agent orchestration framework for stateful, multi-step workflows via `@langchain/langgraph` and `@langchain/core` packages.

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