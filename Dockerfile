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

# Set build-time environment variables
ARG DATABASE_URL
ARG NODE_ENV=production

ENV NODE_ENV=production

# Build the application
RUN npm run build

# ============================================
# Stage 3: Production
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 iliagpt

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

# Copy only necessary files (avoid expensive chown -R by setting ownership during copy)
COPY --from=builder --chown=iliagpt:nodejs /app/dist ./dist
COPY --from=builder --chown=iliagpt:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=iliagpt:nodejs /app/package.json ./package.json
COPY --from=builder --chown=iliagpt:nodejs /app/migrations ./migrations

# Copy public assets
COPY --from=builder --chown=iliagpt:nodejs /app/client/public ./client/public

# Switch to non-root user
USER iliagpt

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start command
# Build outputs dist/index.mjs with a CommonJS wrapper dist/index.cjs
CMD ["node", "dist/index.cjs"]
