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
- **Agent Infrastructure**: Modular plugin architecture with a StateMachine for explicit state transitions, Typed Contracts (Zod schemas) for runtime validation, Event Sourcing for auditability, a PolicyEngine for RBAC and permissions, and an ExecutionEngine with circuit breakers and exponential backoff.
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