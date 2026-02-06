# ILIAGPT Dockerfile
# Multi-stage build for production

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache libc6-compat python3 make g++

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev)
RUN npm ci

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

# Build the application
RUN npm run build

# ============================================
# Stage 3: Production
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 iliagpt

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

# Copy only necessary files with correct ownership (avoid slow chown -R)
COPY --chown=iliagpt:nodejs --from=builder /app/dist ./dist
COPY --chown=iliagpt:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=iliagpt:nodejs --from=builder /app/package.json ./package.json
COPY --chown=iliagpt:nodejs --from=builder /app/migrations ./migrations

# Copy public assets
COPY --chown=iliagpt:nodejs --from=builder /app/client/public ./client/public

# Ensure runtime-writable directories exist for non-root user
RUN mkdir -p /app/sandbox_workspace /app/artifacts \
  && chown -R iliagpt:nodejs /app/sandbox_workspace /app/artifacts

# Switch to non-root user
USER iliagpt

# Expose port
EXPOSE 5000

# Health check (use IPv4 to avoid localhost -> ::1 issues; use -qO- not -q0-)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/health >/dev/null 2>&1 || exit 1

# Start command: build emits dist/index.mjs and a wrapper dist/index.cjs
CMD ["node", "dist/index.cjs"]
