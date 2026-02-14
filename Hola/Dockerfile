# ILIAGPT Dockerfile - Optimized
# Multi-stage build for production

# ============================================
# Stage 1: Dependencies (All)
# ============================================
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json package-lock.json ./
# `npm ci` runs `postinstall`, so ensure any referenced scripts exist in this stage.
COPY scripts/sync-mathjax-assets.cjs scripts/sync-mathjax-assets.cjs
RUN npm ci

# ============================================
# Stage 2: Build
# ============================================
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV VITE_APP_VERSION=$APP_VERSION
# Build client and server
RUN npm run build

# ============================================
# Stage 3: Production Dependencies
# ============================================
# Use Debian-slim to match the runner stage (native modules like node-pty
# compiled against glibc won't work on Alpine's musl).
FROM node:22-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/sync-mathjax-assets.cjs scripts/sync-mathjax-assets.cjs
# Install production dependencies WITH scripts so native modules (e.g. node-pty) build correctly.
RUN npm ci --omit=dev

# ============================================
# Stage 4: Sandbox Runner
# ============================================
# Must use Debian-slim to match prod-deps (native modules need glibc).
FROM node:22-slim AS sandbox-runner

WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# docker CLI (runner executes docker-run jobs via /var/run/docker.sock)
RUN apt-get update && apt-get install -y --no-install-recommends docker.io bash \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV SANDBOX_RUNNER_PORT=8080

# Prod deps + built artifacts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["node", "dist/sandbox-runner.cjs"]

# ============================================
# Stage 5: Production Runner
# ============================================
# Debian-slim base: required for Playwright Chromium (glibc + system libs).
FROM node:22-slim AS runner
WORKDIR /app

# Bake APP_VERSION into the image (source of truth for /api/health version).
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs iliagpt

ENV NODE_ENV=production
ENV PORT=5000

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*

# Copy prod dependencies only (with ownership)
COPY --chown=iliagpt:nodejs --from=prod-deps /app/node_modules ./node_modules
# Copy built artifacts
COPY --chown=iliagpt:nodejs --from=builder /app/dist ./dist
COPY --chown=iliagpt:nodejs --from=builder /app/migrations ./migrations
COPY --chown=iliagpt:nodejs --from=builder /app/client/public ./client/public
COPY --chown=iliagpt:nodejs --from=builder /app/package.json ./package.json

# Install Playwright Chromium + all its system dependencies.
# `install-deps chromium` uses the distro's package manager to install the exact
# set of shared libraries Chromium needs (varies by Debian version).
# `install chromium` downloads the matching Chromium binary.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
RUN npx playwright install-deps chromium \
  && npx playwright install chromium \
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
