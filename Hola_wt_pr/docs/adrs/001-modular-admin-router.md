# 1. Modular Admin Router Architecture

Date: 2026-01-21

## Status

Accepted

## Context

The `server/routes/adminRouter.ts` file had grown into a monolithic module exceeding 1000 lines of code. This created several issues:

- **Maintainability**: Navigating and editing the file was cumbersome.
- **Type Safety**: The large scope made it difficult to enforce strict typing without performance penalties or cognitive overload.
- **Collaboration**: Multiple developers working on different admin features would face constant merge conflicts.
- **Scalability**: Adding new admin features would further degrade the code quality.

## Decision

We decided to decompose the monolithic `adminRouter.ts` into a modular architecture within `server/routes/admin/`. The implementation follows these principles:

1. **Domain Decomposition**: Routes are grouped by domain (e.g., `analytics.ts`, `settings.ts`, `reports.ts`, `agent.ts`).
2. **Centralized Entry Point**: A new `index.ts` aggregates these sub-routers and exports a single `createAdminRouter` factory.
3. **Strict Middleware**: All sub-routers are guarded by the `requireAdmin` middleware at the root level in `index.ts`.

## Consequences

### Positive

- **Improved Readability**: Each file is focused on a single domain, reducing cognitive load.
- **Better Tooling**: Smaller files allow for faster IntelliSense and type checking.
- **Easier Testing**: Individual route modules can be tested in isolation more easily.
- **Scalability**: New features can be added as new files without modifying existing robust code.

### Negative

- **File Proliferation**: There are now more files to manage, though this is a standard trade-off for modularity.
- **Import Complexity**: Imports need to be managed carefully across files, though modern IDEs handle this well.
