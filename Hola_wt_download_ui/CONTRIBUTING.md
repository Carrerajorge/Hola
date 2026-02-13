# Contributing

Thanks for contributing to ILIAGPT.

## Development Setup

1. Install dependencies:

```bash
npm ci
```

2. Create a `.env` file.

`.env.example` documents the required variables. At minimum you need:

- `DATABASE_URL`
- `SESSION_SECRET`
- at least one LLM provider key (for full chat functionality)

3. (Recommended) Start local services:

```bash
docker compose up -d
```

4. Run the app:

```bash
npm run dev
```

## Quality Gates

Before opening a PR, run:

```bash
npm run type-check
npm run test:run
npm run build
```

## Pull Requests

- Keep PRs focused and small when possible.
- Include a clear description and testing notes.
- Do not commit secrets (`.env`, API keys, tokens, private certificates).
- If a change impacts behavior, add or update tests.

## Reporting Security Issues

Please do not open public issues for security vulnerabilities. See `SECURITY.md`.

