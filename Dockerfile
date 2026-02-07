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
# Stage 4: Production Runner
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 iliagpt

ENV NODE_ENV=production
ENV PORT=5000

# Copy prod dependencies only
COPY --from=prod-deps /app/node_modules ./node_modules
# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/client/public ./client/public
COPY --from=builder /app/package.json ./package.json

# Create temp directories for uploads with correct permissions
RUN mkdir -p uploads artifacts && chown -R iliagpt:nodejs /app

USER iliagpt

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "dist/index.cjs"]
