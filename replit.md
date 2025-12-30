# Sira GPT

## Overview
Sira GPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
- **Frameworks**: React with TypeScript, Vite.
- **UI/UX**: shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface (light/dark mode).
- **Content Rendering**: `react-markdown` with plugins for Markdown, code highlighting, and mathematical expressions. Monaco Editor for interactive code.
- **Data Visualization**: Recharts, ECharts, and TanStack Table for interactive data grids.
- **Graphics Rendering**: Multi-layer system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js).
- **Productivity Features**: Chat folders, command history, draft auto-save, context-aware suggested replies, conversation export, message favorites, and prompt templates.
- **Enterprise Features**: PWA support, keyboard shortcuts, offline mode with IndexedDB queuing and auto-sync, unified workspace with resizable panels, and an AI quality system.
- **Performance**: Message virtualization, React.memo, lazy image loading, `useMemo`.
- **Streaming UX**: Indicators, token counter, cancel button, smooth content fade-in.
- **Resilience**: Exponential backoff retry logic, offline message queuing, connection status indicator, error toasts.
- **Security**: DOMPurify sanitization, frontend rate limiting, MIME type validation for file uploads.
- **Accessibility**: Keyboard shortcuts, ARIA live regions, focus management.

### Backend
- **Runtime**: Node.js with Express.js.
- **LLM Gateway**: Centralized management of AI model interactions, providing multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, exponential backoff, per-user rate limiting, request timeouts, response caching, and context truncation.
- **ETL Agent**: Automates economic data processing and generates ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts through Plan, Decompose, Execute, and Aggregate stages.
- **Document Generation System**: Generates Excel (.xlsx) and Word (.docx) files based on Zod schemas, using LLM-driven orchestration with repair loops for validation.
- **Professional CV/Resume Generation System**: Three-layer architecture for structured CV generation with schema, template engine, and intelligent mapping.
- **Spreadsheet Analyzer Module**: AI-powered analysis system with upload/introspection, LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox for execution.
- **System Observability**: Structured JSON logging with correlation IDs, health monitoring, alert manager, and request tracing.
- **Connector Management**: Tracks usage and provides threshold-based alerting for various connectors.

### Infrastructure
- **Security**: Password hashing with bcrypt, multi-tenant validation.
- **Modular Repositories**: Generic base repository with ownership validation, custom errors, and transaction helpers.
- **Error Handling**: Custom error classes and global Express error handler.
- **Structured Logging**: JSON logger with log levels and request correlation.
- **API Validation**: Zod validation middleware for requests.
- **Database Performance**: Optimized indices for frequently queried fields.

### Data Storage
- **Database**: PostgreSQL, managed with Drizzle ORM.
- **Client-side Persistence**: `localStorage` for chat history/preferences, IndexedDB for background tasks and offline queue.
- **Session Storage**: In-memory `MemStorage`.

### Key Design Patterns
- **Monorepo Structure**: `client/`, `server/`, `shared/` directories.
- **Type Safety**: Zod schemas for runtime validation.

## External Dependencies
### AI Services
- **xAI Grok API**: Primary AI model provider (e.g., `grok-3-fast`, `grok-2-vision-1212`) via OpenAI-compatible SDK.
- **Google Gemini API**: Default AI model provider (e.g., `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`) via `@google/genai` SDK.

### Database
- **PostgreSQL**: Relational database for persistent storage.
- **Drizzle Kit**: For database schema migrations.

### CDN Resources
- **KaTeX**: For rendering mathematical expressions.
- **Highlight.js**: Provides code syntax highlighting themes.
- **Google Fonts**: Custom font families (Geist, Inter).

### Key npm Packages (Examples)
- `openai`: For communication with xAI API.
- `drizzle-orm`, `drizzle-zod`: For database interaction and schema validation.
- `react-markdown`: For rich text rendering.
- `recharts`, `echarts`: Charting and data visualization libraries.
- `@tanstack/react-table`, `@tanstack/react-virtual`: For advanced table functionalities.
- `three`: For 3D graphics rendering.
- `d3`: For SVG manipulation.

### External APIs
- **Piston API**: Used for multi-language code execution.
- **World Bank API V2**: Integrated for economic data retrieval by the ETL Agent.
- **Gmail API**: Utilized for Gmail chat integration.