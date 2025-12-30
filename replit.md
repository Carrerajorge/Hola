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

## Security

### Production Vulnerabilities
```
npm audit --omit=dev
found 0 vulnerabilities
```

## Testing

### Prerequisites
- Node.js 18+ installed
- `npm install` completed
- Playwright: `npx playwright install chromium`
- Ports 5000/5173 available (script auto-kills conflicts)

### Running Tests
```bash
# All tests (recommended)
npm run test:all

# Individual suites:
npm run test:run -- server/__tests__/documentAnalysis.test.ts  # 38 unit tests
npm run test:run -- server/__tests__/stressTest.test.ts        # 9 stress tests
npm run test:run -- server/__tests__/sandboxLimits.test.ts     # 10 sandbox tests
npx playwright test --reporter=list                             # 13 E2E tests
```

### Test Files
```
test_fixtures/
├── multi-sheet.xlsx      # 3 sheets (Sales, Employees, Summary)
├── large-10k-rows.xlsx   # 10,000 rows stress test
├── data.csv, document.docx, report.pdf

server/__tests__/
├── documentAnalysis.test.ts  # API contract tests
├── stressTest.test.ts        # 10k row performance
├── sandboxLimits.test.ts     # Security boundary tests
└── mocks/llmMock.ts          # Deterministic LLM mock

e2e/documentAnalysis.spec.ts  # Browser tests with route mocking

shared/analysisContract.ts    # Zod schemas for runtime validation
```

### LLM Mock Strategy (Zero Real Calls)
**E2E Tests**: Playwright `page.route()` intercepts all API calls
**Unit Tests**: `server/__tests__/mocks/llmMock.ts` provides deterministic responses

```typescript
// Import in tests:
import { getMockLLMResponse, mockLLMGatewayModule } from './mocks/llmMock';
mockLLMGatewayModule(); // Replaces llmGateway with mock
```

### API Contract Validation
The `shared/analysisContract.ts` exports Zod schemas that validate response shapes at runtime:

```typescript
import { validateAnalysisResponse } from '@shared/analysisContract';

// Frontend usage - throws clear error if shape mismatches:
const data = await fetch('/api/chat/uploads/123/analysis').then(r => r.json());
const validated = validateAnalysisResponse(data); // Throws if invalid
```

## Python Sandbox Limits

### Configuration
| Resource | Limit | Notes |
|----------|-------|-------|
| Network | **Disabled** | No socket/HTTP allowed |
| Timeout | 60s (hard: 120s) | Auto-kill on timeout |
| Memory | 512 MB | Per-process: 256 MB |
| CPU | 10 processes max | Nice level 19 (low priority) |

### Blocked Modules
`os`, `subprocess`, `shutil`, `socket`, `multiprocessing`, `threading`, `ctypes`, `eval`, `exec`

### Allowed Modules
`pandas`, `numpy`, `json`, `datetime`, `math`, `statistics`, `re`, `collections`

### Sandbox Tests
```bash
npm run test:run -- server/__tests__/sandboxLimits.test.ts
```
Tests verify: network isolation, timeout enforcement, memory limits, blocked imports.

## How to Demo

### Quick Demo (3 min)
1. Open chat interface
2. Upload `test_fixtures/multi-sheet.xlsx` (drag or click attachment)
3. **Observe**: File chip appears in composer with sheet count badge
4. Send message: "Analyze this spreadsheet"
5. **Observe**: 
   - Analysis card appears (minimalist design)
   - Progress bar with sheet status indicators
   - Tabs appear when complete: Summary | Sales | Employees | Summary

### Stress Test Demo (5 min)
1. Upload `test_fixtures/large-10k-rows.xlsx` (445 KB, 10k rows)
2. Send: "Analyze all data in this spreadsheet"
3. **Observe**:
   - No UI freeze during upload/parsing
   - Progress updates smoothly via polling
   - Results load with virtualized preview (first 100 rows)

### Acceptance Criteria (UI)
- [ ] **Composer**: File chip shows filename + sheet count badge
- [ ] **Post-send**: Minimalist analysis card (collapsed by default)
- [ ] **Progress**: Sheet-by-sheet status (✓ done, ⟳ running, ○ queued)
- [ ] **Results**: Tabbed interface with Summary (global) + per-sheet tabs
- [ ] **Per-sheet content**: Generated code (collapsible), metrics, data preview
- [ ] **Error handling**: Failed sheets show error message, others still display

### Test Fixtures
| File | Description | Use Case |
|------|-------------|----------|
| `multi-sheet.xlsx` | 3 sheets, ~20 rows each | Standard multi-sheet analysis |
| `large-10k-rows.xlsx` | 10,000 rows, 9 columns | Performance/virtualization test |
| `data.csv` | Simple CSV | Single-sheet fallback test |
| `document.docx` | Word doc | Non-spreadsheet handling |
| `report.pdf` | PDF | Non-spreadsheet handling |

### Relevant Commits
```
f62b2bc Add comprehensive testing for large file processing
4ed85b6 Add comprehensive testing documentation
9f9ed3f Improve automated testing for document analysis
62f1ccb Add end-to-end tests for document analysis
34d44d1 Adapt document analysis for multiple file types
480739b Add automatic document analysis in chat
```