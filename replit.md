# Sira GPT

## Overview

Sira GPT is an AI-powered chat application that provides an intelligent assistant interface for autonomous web browsing and document creation. The application features a modern chat UI with support for Markdown rendering, code syntax highlighting, and mathematical formula display using LaTeX. It connects to xAI's Grok API for generating AI responses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state, React useState for local state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming (light/dark mode support)
- **Markdown Rendering**: react-markdown with remark-gfm, remark-math, rehype-katex, and rehype-highlight plugins for rich content display

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **API Design**: RESTful endpoints under `/api/*` prefix
- **Build System**: Custom build script using esbuild for server bundling and Vite for client
- **Development**: Hot module replacement via Vite middleware in development mode

### Data Storage
- **Database ORM**: Drizzle ORM configured for PostgreSQL
- **Schema Location**: `shared/schema.ts` contains database table definitions
- **Client-side Persistence**: localStorage for chat history persistence
- **Session Storage**: In-memory storage class (`MemStorage`) for user data during runtime

### Key Design Patterns
- **Monorepo Structure**: Client code in `client/`, server code in `server/`, shared types in `shared/`
- **Path Aliases**: `@/` for client source, `@shared/` for shared modules
- **Component Organization**: UI primitives in `components/ui/`, feature components at `components/` root
- **Type Safety**: Zod schemas with drizzle-zod for runtime validation matching database types

## External Dependencies

### AI Services
- **xAI Grok API**: Primary AI model provider (grok-3-fast model), accessed via OpenAI-compatible SDK with custom baseURL
- **API Key**: `XAI_API_KEY` environment variable required

### Database
- **PostgreSQL**: Primary database, connection via `DATABASE_URL` environment variable
- **Drizzle Kit**: Database migrations stored in `migrations/` directory

### CDN Resources
- **KaTeX**: Math formula rendering (loaded via CDN in index.html)
- **Highlight.js**: Code syntax highlighting styles (GitHub theme via CDN)
- **Google Fonts**: Geist and Inter font families

### Key npm Packages
- `openai`: SDK for xAI API communication
- `drizzle-orm` + `drizzle-zod`: Database ORM and schema validation
- `react-markdown` + plugins: Rich text rendering
- `framer-motion`: UI animations
- `date-fns`: Date formatting utilities
- `connect-pg-simple`: PostgreSQL session store (available but using memory store currently)

## LLM Gateway Architecture

### Production-Ready LLM Gateway (`server/lib/llmGateway.ts`)
The application includes a centralized LLM Gateway that provides enterprise-grade reliability:

**Resilience Patterns:**
- **Circuit Breaker**: 3-state machine (closed/open/half-open) with 5-failure threshold and 30s reset timeout
- **Exponential Backoff Retries**: Up to 3 retries with jittered delays (1s base, 10s max)
- **Per-User Rate Limiting**: Token bucket algorithm (100 tokens/min, refill every 600ms)
- **Request Timeout**: Configurable timeout with AbortController (default 60s)

**Performance Optimizations:**
- **Response Caching**: 5-minute TTL cache keyed by userId + messages + options
- **Context Truncation**: Automatic LIFO truncation to stay within token limits (8000 tokens default)
- **Metrics Collection**: Latency, tokens, errors, cache hits, rate limit hits, circuit breaker status

**Streaming Support:**
- **SSE Endpoint**: `/api/chat/stream` with standard event fields
- **Heartbeat**: 15-second keepalive pings
- **Sequence IDs**: Each chunk numbered for client-side ordering
- **Error Recovery**: Proper connection close detection and cleanup

**API Endpoints:**
- `POST /api/chat` - Standard chat request (uses gateway for non-image requests)
- `POST /api/chat/stream` - SSE streaming chat with resilience
- `GET /api/admin/llm/metrics` - Gateway metrics dashboard

## ETL Agent Architecture

### Automated Economic Data Agent (`server/etl/`)
The application includes a production-ready ETL agent for downloading and processing economic data from official sources:

**Data Sources (Official/Multilateral Only):**
- **World Bank API V2**: Primary source for GDP, inflation, population, trade indicators
- **FRED API**: US Federal Reserve economic data (planned)
- **IMF SDMX**: International Monetary Fund data (planned)

**Normalized Schema:**
All data is normalized to a standard long schema: `Date, Country, Indicator, Value, Unit, Frequency, Source_ID`

**7-Sheet Excel Workbook Structure:**
- `00_README`: Documentation and data dictionary
- `01_SOURCES`: Full source metadata with API endpoints and fetch timestamps
- `02_RAW`: Original data as fetched from APIs
- `03_CLEAN`: Deduplicated and normalized data
- `04_MODEL`: Calculated metrics (YoY changes, growth rates, averages)
- `05_DASHBOARD`: Summary statistics and key figures
- `06_AUDIT`: Data quality test results with PASS/FAIL status

**Audit Engine (6 Test Categories):**
- Coverage: ≥80% of expected date range
- Duplicates: Zero tolerance for duplicate records
- Units: Consistent unit formatting per indicator
- Reconciliation: RAW vs CLEAN record count match
- Extremes: Statistical outlier detection (>3σ)
- Last-complete-month: Data recency validation

**API Endpoints:**
- `GET /api/etl/config` - Available countries and indicators
- `POST /api/etl/run` - Execute ETL pipeline and download workbook

**Frontend Integration:**
- `ETLDialog` component (`client/src/components/etl-dialog.tsx`)
- Accessible via + menu → "ETL Datos Económicos"
- Results appear in chat transcript after download