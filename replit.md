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
- **xAI Grok API**: Primary AI model provider, accessed via OpenAI-compatible SDK with custom baseURL
  - `grok-3-fast`: Fast text generation model
  - `grok-2-vision-1212`: Vision model for image analysis
  - **API Key**: `XAI_API_KEY` environment variable required
- **Google Gemini API**: Default AI model provider via @google/genai SDK
  - `gemini-3-flash-preview`: Newest and fastest model (DEFAULT)
  - `gemini-2.5-flash`: Fast and efficient model
  - `gemini-2.5-pro`: Most capable model
  - **API Key**: `GEMINI_API_KEY` environment variable required
  - Note: Gemini does not support image analysis in current integration

**Model Selection:**
Users can switch between xAI and Gemini models via the dropdown in the chat header. The selected provider and model are passed to `/api/chat` endpoint. Default model is `gemini-3-flash-preview`.

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

**Output Format: ZIP Bundle**
The ETL agent returns a ZIP file containing two Excel workbooks:

1. **ETL_Datos_Completos.xlsx** - Complete data workbook with 7 sheets:
   - `00_README`: Documentation and data dictionary
   - `01_SOURCES`: Full source metadata with API endpoints and fetch timestamps
   - `02_RAW`: Original data as fetched from APIs
   - `03_CLEAN`: Deduplicated and normalized data
   - `04_MODEL`: Calculated metrics (YoY changes, growth rates, averages)
   - `05_DASHBOARD`: Summary statistics and key figures
   - `06_AUDIT`: Data quality test results with PASS/FAIL status

2. **ETL_Grafico_Dashboard.xlsx** - Native Excel chart workbook:
   - Column chart visualization of economic data by country
   - Native Excel chart objects (not images)

3. **LEEME.txt** - Documentation explaining the bundle contents

*Note: Two files are delivered due to technical limitations with embedding native Excel charts in multi-sheet workbooks using open-source libraries.*

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

## Multi-Intent Pipeline Architecture

The application includes a multi-intent pipeline for handling complex user prompts with multiple tasks:

**Pipeline Stages (Plan→Decompose→Execute→Aggregate):**
1. **Plan**: Detect multi-intent prompts and extract structured task list using LLM
2. **Decompose**: Break down prompts into individual atomic tasks with dependencies
3. **Execute**: Run tasks (parallel for independent, sequential for dependent)
4. **Aggregate**: Combine results with validation and error reporting

**Key Files:**
- `shared/schemas/multiIntent.ts` - Zod schemas for TaskPlan, ExecutionResult, PipelineResponse
- `server/agent/pipeline/multiIntentManager.ts` - Intent detection using pattern matching and context
- `server/agent/pipeline/multiIntentPipeline.ts` - Pipeline orchestrator with retry and error handling

**Features:**
- Automatic detection of multi-intent prompts (confidence threshold ≥0.7)
- Parallel execution with Promise.allSettled for independent tasks
- Per-task retry policy with exponential backoff
- Graceful fallback to standard chat on pipeline failure
- Fixed response schema: `{ plan[], results[], errors[], aggregate }`

**Integration:**
- Integrated in `chatService.ts` after route check
- Only used when pipeline completes successfully
- Falls back to standard LLM response on partial/failed completion

## Interactive Code Blocks System

The application includes a comprehensive interactive code blocks system with advanced features:

### Syntax Highlighting
- **Prism.js** with lazy loading of language packs (`client/src/lib/syntaxHighlighter.ts`)
- **Web Worker** for async tokenization (`client/src/workers/prismWorker.ts`)
- **useAsyncHighlight hook** with LRU caching and fallback for small snippets
- 50+ language aliases with dependency management

### Code Block Shell (`client/src/components/code-block-shell.tsx`)
- Unified component for interactive code display
- **Toolbar actions**: Copy, Edit, Run, Annotate
- **Virtualization** for snippets >100 lines using IntersectionObserver
- **Line numbering** with gutter
- **Error line highlighting** with red background
- **Annotation markers** in gutter with type-colored indicators

### Monaco Editor Integration
- **Code-split** loading to avoid bundle bloat (`client/src/components/monaco-code-editor.tsx`)
- **CodeEditorModal** for full-screen editing (`client/src/components/code-editor-modal.tsx`)
- Theme sync (dark/light mode)
- Keyboard shortcuts: Ctrl+S to save, Escape to cancel
- Line decorations for errors and annotations

### Multi-Language Code Execution (Piston API)
- **Backend**: `server/services/pistonService.ts`
- **Frontend**: `client/src/lib/sandboxApi.ts`, `client/src/hooks/useSandboxExecution.ts`
- Supports 50+ languages via Piston public API (https://emkc.org/api/v2/piston/)
- Error line parsing for Python, JavaScript, TypeScript, Go, Rust, C/C++, Java, etc.
- Fallback to local Python interpreter for Python code
- Rate limiting awareness and retry logic

**API Endpoints:**
- `GET /api/sandbox/runtimes` - List available runtimes and languages
- `POST /api/sandbox/execute` - Execute code in sandbox

### Code Annotations System
- **Hook**: `client/src/hooks/useCodeAnnotations.ts` - CRUD operations with localStorage persistence
- **Tooltip**: `client/src/components/code-annotation-tooltip.tsx` - Popover with edit/delete
- **Sidebar**: `client/src/components/code-annotation-sidebar.tsx` - Collapsible panel listing all annotations
- **Marker**: `client/src/components/code-annotation-marker.tsx` - Gutter indicators
- Annotation types: info (blue), warning (amber), error (red), explanation (emerald)

### Usage in MarkdownRenderer
Enable interactive code blocks with:
```tsx
<MarkdownRenderer 
  content={markdown}
  enableInteractiveCode={true}
  interactiveCodeEditable={true}
  onCodeEdit={(newCode) => console.log(newCode)}
/>
```

## Data Visualization System

The application includes a comprehensive data visualization system with charts and smart tables:

### Charts (`client/src/components/charts/`)
- **RechartsChart** (`recharts-chart.tsx`): Bar, line, area, pie, donut, scatter charts
  - Responsive containers, interactive tooltips, zoom/pan, PNG/SVG export
- **EChartsChart** (`echarts-chart.tsx`): Geographic maps and heatmaps
  - Lazy-loaded for bundle optimization
  - World map visualization with scatter points
  - 2D heatmaps with color gradients

### Smart Tables (`smart-table.tsx`)
- **TanStack Table** with full features:
  - Multi-column sorting (click headers, shift+click for multi-sort)
  - Type-aware filtering (text, number range, date range, select, boolean)
  - Debounced global search (300ms)
  - Client-side and server-side pagination
  - Row virtualization via @tanstack/react-virtual for large datasets

### Unified API
- **Schema**: `shared/schemas/visualization.ts` - TypeScript types and Zod schemas
- **Orchestrator**: `VisualizationRenderer` component routes to correct renderer based on config
- **JSON Config**: Declarative configuration for both charts and tables

**Usage:**
```tsx
import { VisualizationRenderer } from '@/components/charts';

<VisualizationRenderer 
  config={{
    id: 'sales-chart',
    type: 'chart',
    chart: {
      type: 'bar',
      data: [{ label: 'Q1', value: 100 }, { label: 'Q2', value: 150 }],
      title: 'Sales by Quarter',
      showTooltip: true,
      enableExport: true
    }
  }}
/>
```

## Figma MCP Integration (Disabled)

The Figma MCP integration is available but currently disabled in the UI. To enable it:

1. Create a Figma OAuth application at https://figma.com/developers/apps
2. Get the Client ID and Client Secret
3. Add `FIGMA_CLIENT_ID` and `FIGMA_CLIENT_SECRET` as environment secrets
4. Re-enable the Figma button in `chat-interface.tsx`

**Backend services are ready:**
- `server/services/figmaService.ts` - Figma API service
- `client/src/components/figma-connector.tsx` - UI component