# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
- **Frameworks**: React with TypeScript and Vite.
- **UI/UX**: shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode. Features include chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, unified workspace, and an AI quality system.
- **Content Rendering**: Supports Markdown, code highlighting (Monaco Editor), and mathematical expressions.
- **Data Visualization**: Recharts, ECharts, and TanStack Table.
- **Graphics Rendering**: Multi-layer system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js).
- **Performance & Resilience**: Message virtualization, memoization, lazy loading, streaming UX indicators, exponential backoff, offline queuing, and error handling.
- **Security & Accessibility**: DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support.

### Backend
- **Runtime**: Node.js with Express.js.
- **LLM Gateway**: Manages AI model interactions with multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, rate limiting, and response caching.
- **ETL Agent**: Automates economic data processing and generates ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts through defined stages (Plan, Decompose, Execute, Aggregate).
- **Document Generation System**: Generates Excel and Word files based on Zod schemas using LLM orchestration with repair loops, including professional CV/Resume generation.
- **Spreadsheet Analyzer Module**: AI-powered analysis, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox for execution.
- **System Observability**: Structured JSON logging with correlation IDs, health monitoring, and request tracing.
- **Agent Infrastructure**: Modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers and exponential backoff.
- **Tool Registry**: Registers 9 core tools: `analyze_spreadsheet`, `web_search`, `generate_image`, `browse_url`, `generate_document`, `read_file`, `write_file`, `shell_command`, `list_files`, with standardized outputs and sandboxed execution.
- **Enhanced Pipeline Tools**: 12 specialized tools for agent execution:
  - **Web**: `search_web`, `web_navigate`, `extract_content` - Web search and content extraction
  - **Files**: `generate_file`, `file_operations` (read/write/edit/search/copy/move) - Comprehensive file management
  - **Code**: `generate_code` (code/SQL/diagrams/regex/API specs), `shell_execute` - Sandboxed code generation and execution
  - **Development**: `webdev_scaffold` (React/Vue/Next.js/Express/FastAPI scaffolding) - Project initialization
  - **Documents**: `slides_generate` (PowerPoint via pptxgenjs) - Presentation creation
  - **Data**: `transform_data`, `analyze_data` - Data processing and insights
  - **Response**: `respond` - Final response generation
- **Phase-Based Planning**: Agent plans organized into logical phases (Research → Planning → Execution → Verification → Delivery) for structured task execution.
- **WebTool Module**: Layered architecture for web navigation and information retrieval (SearchAdapter, FetchAdapter, BrowserAdapter, RetrievalPipeline) with URL canonicalization, content deduplication, quality scoring, content extraction, and sandbox security.
- **Ultra-Fast Web Retrieval System**: High-performance web retrieval with parallel execution, intelligent caching (in-memory, LRU), relevance filtering, and streaming results.
- **Web Retrieval V2**: Enhancements for robustness and stability with BudgetEnforcer, DomainCircuitBreaker, NegativeCache, RequestDeduplicator, HedgedRequestManager, StaleWhileRevalidate, BrowserWatchdog, SourceQualityScorer, DomainDiversityChecker, CitationCoverageEnforcer, and LeakDetection with WorkerRecovery.
- **Agent Orchestration**: Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles.
- **Agent Mode Features**: Event stream tracking (actions/observations/errors), todo.md tracking system, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention in context for learning.
- **Agent Mode UI**: "Computer" view in agent panel showing real-time events, todo list with status indicators, and workspace files browser.
- **Agent Mode Limitations (MVP)**: Event stream, todo list, and workspace files are stored in-memory only during active runs. Data is not persisted to database after run completion (future enhancement planned).
- **Agent Event Schema**: Standardized event schema with `kind` (action/observation/verification/error/plan/thinking/progress/result), `status` (ok/warn/fail), `title`, `summary`, `confidence`, and `payload` fields. Events are normalized by `normalizeAgentEvent()` mapper for human-readable UI rendering with collapsible JSON details.
- **Agent Cancellation System**: Robust cancellation with AbortController/CancellationToken propagated end-to-end. States: queued → planning → running → verifying → completed|failed|cancelled, with intermediate states `paused` and `cancelling`. Cancel button always active during active states (queued, planning, running, verifying, paused). Guarantees: (1) No tool calls after cancel request, (2) Cleanup handlers invoked for Playwright contexts/fetch/sandbox, (3) Events `run_cancel_requested` and `run_cancelled` emitted, (4) Status persisted with `cancel_requested_at` and `ended_at` timestamps. Pause/Resume supported via POST /api/agent/runs/:id/pause and /resume endpoints.
- **Router System** (v1.0 - Production-Ready, Battle-Tested): Hybrid decision system that automatically routes messages between chat (simple responses) and agent mode (multi-step tasks with tools). Uses a cascade: (1) Heuristic patterns for quick detection, (2) ComplexityAnalyzer fallback, (3) LLM router for ambiguous cases. Configuration via environment variables: `ROUTER_CONFIDENCE_THRESHOLD` (default 0.65), `MAX_AGENT_STEPS` (default 8), `ENABLE_DYNAMIC_ESCALATION` (default true). Endpoints: POST /api/chat/route, POST /api/chat/agent-run, POST /api/chat/escalation-check. Validated: 100% routing accuracy (30/30 prompts), 0 crashes, deterministic behavior, concurrent isolation, graceful LLM degradation.
- **AgentRunner** (v1.0 - Production-Ready): Simplified agent loop for executing multi-step tasks. Supports 4 tools: `web_search`, `open_url`, `extract_text`, `final_answer`. Features: heuristic fallback when LLM unavailable, event emission for progress tracking, configurable max steps, InMemoryRunStore with IRunStore interface (DB-ready), guardrails (maxConsecutiveFailures=2, warning banner at max steps), structured JSON logging with run_id/traceId/duration_ms.
- **Sandbox Agent V2** (Production-Ready): Comprehensive TypeScript agent system with phase-based execution, automatic task decomposition, and secure sandboxed operations.
  - **Core Modules**: Located in `server/agent/sandbox/`:
    - `agentTypes.ts` - Zod schemas for phases, steps, task plans, and agent state
    - `documentCreator.ts` - Creates professional PPTX, DOCX, XLSX documents using pptxgenjs, docx, and exceljs
    - `tools.ts` - 8-tool system (shell, file, python, search, browser, document, message, research) with BaseTool abstract class
    - `taskPlanner.ts` - Automatic task decomposition from user input with intent detection (12 intents, EN/ES support)
    - `agentV2.ts` - Main orchestrator with state machine (idle → analyzing → planning → executing → delivering)
  - **Security Hardening**: 
    - HTTP API exposes only 5 safe tools: search, browser, document, message, research
    - Shell/file tools require authenticated sandbox sessions via `sandboxService`
    - All routes require authentication (`requireAuth` middleware)
    - Max iterations capped at 50, timeout at 120s
  - **API Endpoints** (via `sandboxAgentRouter.ts`):
    - `POST /api/sandbox/agent/run` - Execute agent with user input
    - `POST /api/sandbox/agent/tool` - Execute single tool (safe tools only)
    - `POST /api/sandbox/agent/plan` - Create task plan without execution
    - `POST /api/sandbox/agent/detect-intent` - Detect intent from text
    - `GET /api/sandbox/agent/tools` - List available tools
    - `POST/GET/DELETE /api/sandbox/session` - Session management
- **Python Agent v5.0** (Enterprise Edition): Standalone Python-based agent system with advanced features.
  - **Location**: `server/agent/python_agent/`
  - **Core Features**:
    - `agent_v5.py` - Full agent implementation with 8 tools (shell, file, python, search, browser, document, message, research)
    - Multi-level cache (Memory + Disk) with LRU eviction
    - Per-domain rate limiting with token bucket algorithm
    - Rich console visualization with real-time progress
    - Browser pool with Playwright/Selenium/HTTPX fallback
    - Security guard with command/URL validation
    - Pattern-based intent detection for 14 intents (EN/ES)
  - **HTTP Service** (`service.py`):
    - FastAPI-based REST API on port 8081
    - Endpoints: `/run`, `/health`, `/tools`, `/status`
    - CORS enabled, async support
  - **API Routes** (via main Express server):
    - `POST /api/python-agent/run` - Execute Python agent
    - `GET /api/python-agent/tools` - List Python agent tools
    - `GET /api/python-agent/health` - Health check
    - `GET /api/python-agent/status` - Quick availability check
  - **Document Generation**: PowerPoint, Word, Excel with premium themes
  - **Usage**: Start service with `cd server/agent/python_agent && python run_service.py`

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