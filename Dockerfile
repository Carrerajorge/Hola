# ILIAGPT Dockerfile - Optimized
# Multi-stage build for production

# ============================================
# Stage 1: Dependencies (All)
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# Build client and server
RUN npm run build

# ============================================
# Stage 3: Production Dependencies
# ============================================
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install ONLY production dependencies, skipping scripts to be faster/safer
RUN npm ci --only=production --ignore-scripts

# ============================================
# Stage 4: Sandbox Runner
# ============================================
FROM node:20-alpine AS sandbox-runner

WORKDIR /app

# docker CLI (runner executes docker-run jobs via /var/run/docker.sock)
RUN apk add --no-cache docker-cli bash

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
FROM node:20-alpine AS runner
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 iliagpt

ENV NODE_ENV=production
ENV PORT=5000

# Copy prod dependencies only (with ownership)
COPY --chown=iliagpt:nodejs --from=prod-deps /app/node_modules ./node_modules
# Copy built artifacts
COPY --chown=iliagpt:nodejs --from=builder /app/dist ./dist
COPY --chown=iliagpt:nodejs --from=builder /app/migrations ./migrations
COPY --chown=iliagpt:nodejs --from=builder /app/client/public ./client/public
COPY --chown=iliagpt:nodejs --from=builder /app/package.json ./package.json

# Create temp directories for uploads/sandbox with correct permissions
# (We only need to chown these specific dirs, files are already owned via COPY)
RUN mkdir -p /app/uploads /app/artifacts /app/sandbox_workspace \
  && chown -R iliagpt:nodejs /app/uploads /app/artifacts /app/sandbox_workspace

USER iliagpt

EXPOSE 5000

# Health check (use IPv4 to avoid localhost -> ::1 issues)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.cjs"]
