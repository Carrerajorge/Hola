# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies (python for node-gyp if needed)
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package*.json ./
# Clean install based on lock file
RUN npm ci

# Copy source
COPY . .

# Build (TypeScript -> JS)
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Production environment
ENV NODE_ENV=production
ENV PORT=5000

# Install runtime dependencies (ffmpeg for audio/video processing)
RUN apk add --no-cache ffmpeg

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
# Copy static assets (reports, drafts)
COPY --from=builder /app/public ./public

# Create non-root user for security (NASA-grade)
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 5000

CMD ["node", "dist/index.js"]
