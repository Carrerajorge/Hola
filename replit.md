# Sira GPT

## Overview
Sira GPT is an AI-powered chat application offering an intelligent assistant for autonomous web browsing and document creation. It features a modern chat UI with rich content rendering (Markdown, code highlighting, LaTeX) and connects to various AI APIs for generative responses. The project aims to provide a versatile platform for AI-driven tasks, including economic data analysis and multi-intent prompt processing.

## User Preferences
Preferred communication style: Simple, everyday language.

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
- **LLM Gateway**: Centralized `llmGateway.ts` for enterprise-grade reliability with Circuit Breaker, Exponential Backoff Retries, Per-User Rate Limiting, Request Timeout, Response Caching, Context Truncation, Metrics Collection, and SSE Streaming.
- **ETL Agent**: Automated economic data processing from official sources (e.g., World Bank API) into normalized schemas and ZIP bundles with Excel workbooks and audit reports.
- **Multi-Intent Pipeline**: Processes complex user prompts via Plan → Decompose → Execute → Aggregate stages, featuring automatic detection, parallel execution, and error handling.

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