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