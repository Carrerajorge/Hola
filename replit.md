# Sira GPT

## Overview
Sira GPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. It features a modern chat UI with rich content rendering and integrates with various AI APIs to provide generative responses. The project's core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
- **Frameworks**: React with TypeScript, Vite for bundling.
- **UI/UX**: shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface (light/dark mode).
- **Routing**: Wouter for client-side navigation.
- **State Management**: TanStack React Query for server state synchronization, React `useState` for local component state.
- **Content Rendering**: `react-markdown` with extensive plugins for Markdown, code highlighting (Prism.js with Web Worker), and mathematical expressions (KaTeX). Monaco Editor is integrated for interactive code.
- **Data Visualization**: Utilizes Recharts (bar, line, area, pie, scatter), ECharts (maps, heatmaps), and TanStack Table for interactive data grids with sorting, filtering, and virtualization.
- **Graphics Rendering**: A multi-layer system supports SVG (D3.js), Canvas 2D, and 3D (Three.js) with capability detection and fallbacks.
- **Professional Features**: Includes PWA support, keyboard shortcuts, conversation export (TXT, JSON, Markdown), message favorites, and prompt templates.
- **Productivity Features**: Offers chat folders, command history, draft auto-save, and context-aware suggested replies.
- **Background Processing System**: An enterprise-grade system using Web Workers, IndexedDB for task persistence, and BroadcastChannel for multi-tab coordination, ensuring task completion even when the user navigates away.
- **Enterprise Features**: Offline mode with IndexedDB queuing and auto-sync, a unified workspace with resizable panels and an AI Steps Rail, and an AI quality system for response analysis and content filtering.
- **Performance Optimizations**: Message virtualization with @tanstack/react-virtual (threshold: 50+ messages), React.memo with custom comparison functions, lazy image loading with skeleton placeholders, useMemo for expensive computations.
- **Streaming UX**: StreamingIndicator component with typing animation (3 dots), token counter display, prominent cancel button with pulsing animation, and smooth content fade-in effects.
- **Resilience Features**: Exponential backoff retry logic (base 1s, max 30s with jitter), offline message queuing with auto-sync, ConnectionDot status indicator, user-friendly error toasts.
- **Security Hardening**: DOMPurify sanitization for all markdown content, frontend rate limiting (3 messages per 10 seconds), MIME type validation with magic byte detection for file uploads.
- **Accessibility**: Keyboard shortcuts (Escape to cancel streaming, Ctrl+/ for shortcuts dialog), ARIA live regions for screen reader announcements, proper focus management.

### Backend
- **Runtime**: Node.js with Express.js for RESTful API endpoints.
- **Build System**: esbuild for server, Vite for client.
- **LLM Gateway**: A centralized `llmGateway.ts` manages AI model interactions, providing multi-provider fallback (e.g., xAI to Gemini), request deduplication, streaming recovery, token usage tracking, circuit breakers, exponential backoff, per-user rate limiting, request timeouts, response caching, and context truncation.
- **ETL Agent**: Automates economic data processing from external sources into normalized schemas and generates ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts through stages: Plan, Decompose, Execute, and Aggregate, with automatic detection and parallel execution.
- **Document Generation System**: Generates Excel (.xlsx) and Word (.docx) files based on Zod schemas (`shared/documentSpecs.ts`), using LLM-driven orchestration with repair loops for validation. Includes dedicated services for rendering Excel and Word documents.
- **Professional CV/Resume Generation System**: A three-layer architecture for structured CV generation, featuring a `CvSpec` schema, a template engine with multiple layouts and styling options, and an intelligent mapping layer for data formatting and visual elements. It uses dedicated prompts for CV content generation.
- **System Observability**: Implements structured JSON logging with correlation IDs (`server/utils/logger.ts`), health monitoring for AI providers and the database, an alert manager, and request tracing middleware with AsyncLocalStorage context propagation.
- **Connector Management**: Tracks usage and provides threshold-based alerting for various connectors (e.g., Gmail, Gemini).

### Infrastructure (Enterprise-Grade)
- **Security**:
  - Password hashing with bcrypt (12 salt rounds) via `server/utils/password.ts`
  - Backwards-compatible password migration on login
  - Multi-tenant validation in repository layer
- **Modular Repositories** (`server/repositories/`):
  - `baseRepository.ts`: Ownership validation, custom errors (OwnershipError, ValidationError, NotFoundError), transaction helpers, structured logging
  - `userRepository.ts`: User CRUD with validation
  - `chatRepository.ts`: Chat/message operations with ownership checks
- **Error Handling** (`server/utils/`):
  - Custom error classes: AppError, ValidationError, NotFoundError, AuthenticationError, AuthorizationError, RateLimitError, ExternalServiceError
  - Retry utility with exponential backoff (`retry.ts`)
  - Circuit breaker pattern for external service calls (`circuitBreaker.ts`)
  - Global Express error handler middleware (`server/middleware/errorHandler.ts`)
- **Structured Logging**:
  - JSON logger with log levels via LOG_LEVEL env var (`server/utils/logger.ts`)
  - Request correlation with traceId via AsyncLocalStorage (`server/middleware/correlationContext.ts`)
  - Request logging middleware with duration tracking (`server/middleware/requestLogger.ts`)
- **API Validation**:
  - Zod validation middleware for body/query/params (`server/middleware/validateRequest.ts`)
  - Common API schemas with pagination, sorting, UUID validation (`server/schemas/apiSchemas.ts`)
- **Database Performance**:
  - Optimized indices for frequently queried fields (chatMessages.chatId, chats.userId, aiModels.provider, etc.)
  - Migration file: `server/migrations/add_performance_indices.sql`

### Data Storage
- **Database**: PostgreSQL, managed with Drizzle ORM for schema definition and migrations.
- **Client-side Persistence**: `localStorage` for chat history and user preferences, IndexedDB for background task persistence and offline queue.
- **Session Storage**: In-memory `MemStorage`.

### Key Design Patterns
- **Monorepo Structure**: Organized into `client/`, `server/`, and `shared/` directories.
- **Type Safety**: Enforced using Zod schemas for runtime validation across the stack.

## External Dependencies
### AI Services
- **xAI Grok API**: Primary AI model provider (e.g., `grok-3-fast`, `grok-2-vision-1212`) via OpenAI-compatible SDK.
- **Google Gemini API**: Default AI model provider (e.g., `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`) via `@google/genai` SDK.

### Database
- **PostgreSQL**: The relational database used for persistent storage.
- **Drizzle Kit**: Utilized for database schema migrations.

### CDN Resources
- **KaTeX**: For rendering mathematical expressions.
- **Highlight.js**: Provides code syntax highlighting themes.
- **Google Fonts**: Used for custom font families (Geist, Inter).

### Key npm Packages
- `openai`: For communication with xAI API.
- `drizzle-orm`, `drizzle-zod`: For database interaction and schema validation.
- `react-markdown`: For rich text rendering.
- `framer-motion`: For UI animations.
- `date-fns`: For date manipulation.
- `recharts`, `echarts`: Charting and data visualization libraries.
- `@tanstack/react-table`, `@tanstack/react-virtual`: For advanced table functionalities.
- `three`: For 3D graphics rendering.
- `d3`: For SVG manipulation.

### External APIs
- **Piston API**: Used for multi-language code execution.
- **World Bank API V2**: Integrated for economic data retrieval by the ETL Agent.
- **Gmail API**: Utilized for the Gmail chat integration, including email fetching and parsing.