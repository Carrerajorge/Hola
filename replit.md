# Sira GPT

## Overview
Sira GPT is an AI-powered chat application offering an intelligent assistant for autonomous web browsing and document creation. It features a modern chat UI with rich content rendering (Markdown, code highlighting, LaTeX) and connects to various AI APIs for generative responses. The project aims to provide a versatile platform for AI-driven tasks, including economic data analysis and multi-intent prompt processing.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes (December 2024)

### Gmail Integration (STABLE - DO NOT MODIFY)
- **Custom OAuth Flow**: Gmail OAuth with custom credentials via `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- **Files**:
  - `server/services/gmailChatIntegration.ts`: Main Gmail chat integration with AI-powered email analysis
  - `server/services/gmailService.ts`: Gmail API wrapper for fetching and parsing emails
  - `client/src/lib/gmailIntentDetector.ts`: Detects Gmail-related intents in user messages
  - `server/routes/chatAiRouter.ts`: Chat AI router with Gmail context injection
- **Features**:
  - Spanish date parsing: "hoy", "ayer", "23 de diciembre" → Gmail date queries (YYYY/MM/DD format)
  - Email summaries with sender, subject, time, 2-line summary
  - Gmail logo at end of each email summary (1.4em, inline, eager loading)
  - Sender pattern extraction excluding date keywords

### Table & Chart Hover Buttons (STABLE - DO NOT MODIFY)
- **Tables** (Markdown and SmartTable):
  - Copy button (copies as tab-separated text)
  - Download CSV button
  - Expand/Minimize button (fullscreen overlay)
- **Charts** (Recharts and ECharts):
  - Download PNG button
  - Download SVG button
  - Zoom reset button (if enabled)
- **Files**:
  - `client/src/components/markdown-renderer.tsx`: TableWrapper component with hover buttons
  - `client/src/components/message-list.tsx`: CleanDataTableWrapper with hover buttons
  - `client/src/components/charts/recharts-chart.tsx`: Hover export buttons
  - `client/src/components/charts/echarts-chart-impl.tsx`: Hover export buttons
  - `client/src/components/charts/smart-table.tsx`: Copy, download, expand buttons
- **Styling**: `opacity-0 group-hover:opacity-100` pattern, `z-10` for visibility

### Professional Features (December 2024 - STABLE)
- **Keyboard Shortcuts** (`client/src/hooks/use-keyboard-shortcuts.ts`):
  - Ctrl+N: New chat, Ctrl+K: Search, Ctrl+E: Export, Ctrl+T: Templates
  - Ctrl+Shift+F: Favorites, Ctrl+/: Show shortcuts, Escape: Close dialogs
- **PWA Support** (`client/public/manifest.json`):
  - Installable app with standalone display mode
  - Theme colors matching dark mode
- **Export Conversations** (`client/src/components/export-chat-dialog.tsx`):
  - TXT, JSON, and Markdown export formats
- **Favorites System** (`client/src/hooks/use-favorites.ts`, `client/src/components/favorites-dialog.tsx`):
  - Star important messages, localStorage persistence
  - Search and navigate to original chat
- **Prompt Templates** (`client/src/hooks/use-prompt-templates.ts`, `client/src/components/prompt-templates-dialog.tsx`):
  - Predefined templates with categories
  - Custom templates, usage tracking
- **Browser Notifications** (`client/src/hooks/use-notifications.ts`):
  - Notify when background task completes
- **Sidebar Indicators**:
  - SVG spinner for active chats, badge for pending responses

### Productivity Features (December 2024 - STABLE)
- **Chat Folders** (`client/src/hooks/use-chat-folders.ts`):
  - Create folders with 6 color options
  - Drag chats into folders, collapsible groups
  - localStorage persistence
- **Command History** (`client/src/hooks/use-command-history.ts`):
  - Arrow up/down to navigate previous messages
  - Last 50 messages stored
- **Draft Auto-save** (`client/src/hooks/use-draft.ts`):
  - Debounced save per chat
  - Restore on chat switch
- **Suggested Replies** (`client/src/components/suggested-replies.tsx`):
  - Context-aware suggestions after AI responses
  - Code, list, and default suggestion types

### UI Cleanup (STABLE)
- Removed "Conectores" button from composer UI (`client/src/components/composer.tsx`)

## System Architecture
### Frontend
- **Framework**: React with TypeScript, Vite.
- **UI/UX**: shadcn/ui (Radix UI) with Tailwind CSS for theming (light/dark mode).
- **Routing**: Wouter.
- **State Management**: TanStack React Query (server state), React `useState` (local state).
- **Content Rendering**: `react-markdown` with plugins for Markdown, code, and math.
- **Interactive Code Blocks**: Prism.js (async highlighting via Web Worker), Monaco Editor integration, and multi-language execution via Piston API.
- **Data Visualization**: Recharts (bar, line, area, pie, scatter), ECharts (maps, heatmaps), and TanStack Table (smart tables with sorting, filtering, pagination, virtualization).
- **Graphics Rendering**: Multi-layer system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js) with capability detection and fallback.

### Backend
- **Runtime**: Node.js with Express.js.
- **API Design**: RESTful endpoints.
- **Build System**: esbuild (server), Vite (client).
- **LLM Gateway**: Centralized `llmGateway.ts` for enterprise-grade reliability:
  - **Multi-Provider Fallback**: xAI → Gemini automatic failover with per-provider circuit breakers
  - **Request Deduplication**: SHA256 content hashing prevents duplicate API calls for in-flight requests
  - **Streaming Recovery**: Checkpoint system every 10 chunks for stream resumption
  - **Token Usage Tracking**: Per-request metrics (provider, user, model, tokens, latency), `getTokenUsageStats(since)` for analytics
  - **Health Check**: `healthCheck()` method tests both providers with latency measurement
  - Circuit Breaker, Exponential Backoff Retries, Per-User Rate Limiting, Request Timeout, Response Caching, Context Truncation
- **ETL Agent**: Automated economic data processing from official sources (e.g., World Bank API) into normalized schemas and ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts via Plan → Decompose → Execute → Aggregate stages, featuring automatic detection, parallel execution, and error handling.
- **Document Generation System**: Spec-based document rendering for Excel (.xlsx) and Word (.docx) files with LLM-driven generation and validation repair loops.
  - `shared/documentSpecs.ts`: Zod schemas for ExcelSpec, DocSpec, CvSpec, ReportSpec, LetterSpec with typed sections.
  - `server/services/excelSpecRenderer.ts`: Renders Excel workbooks from ExcelSpec JSON using ExcelJS.
  - `server/services/wordSpecRenderer.ts`: Renders Word documents from DocSpec JSON using docx package.
  - `server/services/documentOrchestrator.ts`: LLM orchestrator with Gemini integration and 3-attempt repair loop.
  - API endpoints: `/api/documents/render/excel`, `/api/documents/render/word`, `/api/documents/generate/excel`, `/api/documents/generate/word`.
- **Professional CV/Resume Generation System**: Three-layer architecture for structured document generation:
  - **Structured Output Layer**: CvSpec schema with header, work_experience, education, skills (proficiency 1-5), languages, certifications, projects.
  - **Template Engine**: `server/services/documentTemplates.ts` - 4 CV templates (modern, classic, creative, minimalist) with layout configs (single-column, two-column, sidebar), fonts, colors, skill styles (dots/bars/tags/percentage/text).
  - **Intelligent Mapping Layer**: `server/services/documentMappingService.ts` - date formatting, skill visual generation (generateSkillDots, generateSkillBar), template selection.
  - **CV Renderer**: `server/services/cvRenderer.ts` - Professional DOCX generation with two-column layouts, skill badges, photo placeholders, section styling.
  - **Document Prompts**: `server/services/documentPrompts.ts` - CV-specific prompts with action verbs, quantifiable metrics, industry keywords.
  - API endpoints: POST `/api/documents/generate/cv`, `/api/documents/generate/report`, `/api/documents/generate/letter`, `/api/documents/render/cv`.

### Data Storage
- **Database ORM**: Drizzle ORM for PostgreSQL.
- **Client-side Persistence**: `localStorage` for chat history.
- **Session Storage**: In-memory `MemStorage`.

### Key Design Patterns
- **Monorepo**: `client/`, `server/`, `shared/` directories.
- **Type Safety**: Zod schemas for runtime validation.

## External Dependencies
### AI Services
- **xAI Grok API**: Primary AI model provider (`grok-3-fast`, `grok-2-vision-1212`) via OpenAI-compatible SDK. Requires `XAI_API_KEY`.
- **Google Gemini API**: Default AI model provider (`gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`) via `@google/genai` SDK. Requires `GEMINI_API_KEY`.

### Database
- **PostgreSQL**: Primary database. Configured via `DATABASE_URL`.
- **Drizzle Kit**: For database migrations.

### CDN Resources
- **KaTeX**: Math formula rendering.
- **Highlight.js**: Code syntax highlighting styles (GitHub theme).
- **Google Fonts**: Geist and Inter font families.

### Key npm Packages
- `openai`: For xAI API communication.
- `drizzle-orm`, `drizzle-zod`: Database ORM and schema validation.
- `react-markdown` and related plugins: Rich text rendering.
- `framer-motion`: UI animations.
- `date-fns`: Date formatting.
- `connect-pg-simple`: PostgreSQL session store (available).
- `recharts`, `echarts`: Charting libraries.
- `@tanstack/react-table`, `@tanstack/react-virtual`: Smart tables.
- `three`: 3D graphics.
- `d3`: SVG manipulation.

### External APIs
- **Piston API**: For multi-language code execution.
- **World Bank API V2**: For economic data (ETL Agent).
- **FRED API**: (Planned) US Federal Reserve economic data.
- **IMF SDMX**: (Planned) International Monetary Fund data.
- **Figma API**: (Disabled by default) Integration for Figma design files. Requires `FIGMA_CLIENT_ID` and `FIGMA_CLIENT_SECRET`.