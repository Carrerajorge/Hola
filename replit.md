# Sira GPT

## Overview
Sira GPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for Sira GPT to become a leading AI assistant for productivity.

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
- **WebTool Module**: Layered architecture for web navigation and information retrieval (SearchAdapter, FetchAdapter, BrowserAdapter, RetrievalPipeline) with URL canonicalization, content deduplication, quality scoring, content extraction, and sandbox security.
- **Ultra-Fast Web Retrieval System**: High-performance web retrieval with parallel execution, intelligent caching (in-memory, LRU), relevance filtering, and streaming results.
- **Web Retrieval V2**: Enhancements for robustness and stability with BudgetEnforcer, DomainCircuitBreaker, NegativeCache, RequestDeduplicator, HedgedRequestManager, StaleWhileRevalidate, BrowserWatchdog, SourceQualityScorer, DomainDiversityChecker, CitationCoverageEnforcer, and LeakDetection with WorkerRecovery.
- **Agent Orchestration**: Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles.
- **Agent Mode Features**: Event stream tracking (actions/observations/errors), todo.md tracking system, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention in context for learning.
- **Agent Mode UI**: "Computer" view in agent panel showing real-time events, todo list with status indicators, and workspace files browser.
- **Agent Mode Limitations (MVP)**: Event stream, todo list, and workspace files are stored in-memory only during active runs. Data is not persisted to database after run completion (future enhancement planned).

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