# ILIAGPT Dockerfile - Optimized for lower disk usage in GitHub/VPS builds
# Multi-stage build for production

# ============================================
# Stage 1: Build (dependencies + compile)
# ============================================
FROM node:20-slim AS builder
WORKDIR /app

# Build-time tooling for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Full deps for build
COPY package.json package-lock.json ./
# Ensure mathjax sync script exists before npm ci postinstall hook
COPY scripts/sync-mathjax-assets.cjs scripts/sync-mathjax-assets.cjs
RUN npm ci --ignore-scripts \
  && npm rebuild esbuild bcrypt node-pty sharp \
  && node scripts/sync-mathjax-assets.cjs \
  && npm cache clean --force

# Build client and server assets
COPY . .
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build

# Convert to production-only deps for runtime images
RUN npm prune --omit=dev

# ============================================
# Stage 2: Sandbox Runner
# ============================================
FROM node:20-slim AS sandbox-runner
WORKDIR /app

# Bake APP_VERSION into the image so runtime can report the deployed commit SHA
# even if docker-compose environment expansion is missing/misconfigured.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# docker CLI (runner executes docker-run jobs via /var/run/docker.sock)
RUN apt-get update && apt-get install -y --no-install-recommends docker.io bash \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

ENV NODE_ENV=production
ENV SANDBOX_RUNNER_PORT=8080

# Runtime deps + built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["node", "dist/sandbox-runner.cjs"]

# ============================================
# Stage 3: Production Runner
# ============================================
FROM node:20-slim AS runner
WORKDIR /app

# Bake APP_VERSION into the image (source of truth for /api/health version).
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs iliagpt

ENV NODE_ENV=production
ENV PORT=5000

# Install Playwright Chromium system dependencies + wget for healthcheck.
# These are the shared libraries Playwright's bundled Chromium needs on Debian.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash \
      wget ca-certificates fonts-liberation \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 \
      libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 libxshmfence1 xdg-utils \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Copy prod dependencies only (with ownership)
COPY --chown=iliagpt:nodejs --from=builder /app/node_modules ./node_modules
# Copy built artifacts
COPY --chown=iliagpt:nodejs --from=builder /app/dist ./dist
COPY --chown=iliagpt:nodejs --from=builder /app/migrations ./migrations
COPY --chown=iliagpt:nodejs --from=builder /app/client/public ./client/public
COPY --chown=iliagpt:nodejs --from=builder /app/package.json ./package.json

# Download Playwright's bundled Chromium browser binary.
# System deps are installed above via apt-get; here we only fetch the browser.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
RUN node ./node_modules/playwright/cli.js install chromium \
  && chown -R iliagpt:nodejs /app/.playwright-browsers

# Create temp directories for uploads/sandbox with correct permissions
RUN mkdir -p /app/uploads /app/artifacts /app/sandbox_workspace /app/data \
  && chown -R iliagpt:nodejs /app/uploads /app/artifacts /app/sandbox_workspace /app/data

USER iliagpt

EXPOSE 5000

# Health check (use IPv4 to avoid localhost -> ::1 issues)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.cjs"]
