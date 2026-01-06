# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### UI/UX
- **Frontend**: React with TypeScript and Vite, utilizing shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode.
- **Features**: Chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, unified workspace, and an AI quality system.
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
- **Document Generation System**: Generates Excel and Word files using LLM orchestration with repair loops, including professional CV/Resume generation.
- **Spreadsheet Analyzer Module**: AI-powered analysis, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox for execution.
- **Agent Infrastructure**: Modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers and exponential backoff.
- **Tool Registry**: Registers 9 core tools (`analyze_spreadsheet`, `web_search`, `generate_image`, `browse_url`, `generate_document`, `read_file`, `write_file`, `shell_command`, `list_files`) with standardized outputs and sandboxed execution.
- **Enhanced Pipeline Tools**: 12 specialized tools for agent execution covering Web (search, navigate, extract), Files (generate, operations), Code (generate, shell_execute), Development (webdev_scaffold), Documents (slides_generate), Data (transform, analyze), and Response (respond).
- **Phase-Based Planning**: Agent plans organized into logical phases (Research → Planning → Execution → Verification → Delivery).
- **WebTool Module**: Layered architecture for web navigation and information retrieval with URL canonicalization, content deduplication, quality scoring, content extraction, and sandbox security.
- **Ultra-Fast Web Retrieval System**: High-performance web retrieval with parallel execution, intelligent caching, relevance filtering, and streaming results.
- **Agent Orchestration**: Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles.
- **Agent Mode Features**: Event stream tracking, todo.md tracking, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention in context for learning.
- **Agent Cancellation System**: Robust cancellation with AbortController/CancellationToken propagation, supporting states like queued, planning, running, verifying, completed, failed, and cancelled.
- **Router System**: Hybrid decision system to route messages between chat and agent mode using heuristic patterns, complexity analysis, and LLM routing for ambiguous cases.
- **AgentRunner**: Simplified agent loop for executing multi-step tasks with heuristic fallback, event emission, configurable max steps, and guardrails.
- **Sandbox Agent V2**: Comprehensive TypeScript agent system with phase-based execution, automatic task decomposition, and secure sandboxed operations (8 tools, 5 safe HTTP exposed).
- **Python Agent v5.0**: Standalone Python-based agent system with 8 tools, multi-level caching, per-domain rate limiting, browser pool, security guard, and pattern-based intent detection.
- **LangGraph Agent System**: Enterprise-grade agent orchestration using the LangGraph framework with StateGraph-based workflow management, supervisor and reflection patterns, human-in-the-loop approvals, PostgreSQL checkpoint persistence, and conversation memory.

### Infrastructure
- **Security**: Password hashing with bcrypt, multi-tenant validation, authentication middleware, max iterations/timeout for agent runs.
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