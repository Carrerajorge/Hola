# ILIAGPT Dockerfile - Optimized for lower disk usage in GitHub/VPS builds Multi-stage build for production

# ============================================
# Stage 1: Build (dependencies + compile)
# ============================================
FROM node:22-slim AS builder
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
# Copy all source files BEFORE npm install so file: dependencies (like @hola/openclaw) resolve
COPY . .
RUN set -eux; \
  retry_npm() { \
  attempt=1; \
  while [ "$attempt" -le 3 ]; do \
  if "$@"; then \
  return 0; \
  fi; \
  if [ "$attempt" -eq 3 ]; then \
  return 1; \
  fi; \
  sleep_seconds=$((attempt * 15)); \
  echo "npm command failed on attempt ${attempt}; retrying in ${sleep_seconds}s..." >&2; \
  sleep "$sleep_seconds"; \
  attempt=$((attempt + 1)); \
  done; \
  }; \
  export npm_config_fetch_retries=5; \
  export npm_config_fetch_timeout=120000; \
  export npm_config_fetch_retry_mintimeout=20000; \
  export npm_config_fetch_retry_maxtimeout=120000; \
  export npm_config_maxsockets=4; \
  retry_npm npm install --legacy-peer-deps --no-audit --no-fund --ignore-scripts; \
  retry_npm npm i ajv@^8.18.0 ajv-formats@^3.0.1 --legacy-peer-deps --no-audit --no-fund --save-prod; \
  retry_npm npm i -D @rollup/rollup-linux-x64-gnu --legacy-peer-deps --no-audit --no-fund; \
  retry_npm npm i -D lightningcss-linux-x64-gnu --legacy-peer-deps --no-audit --no-fund; \
  retry_npm npm i -D @tailwindcss/oxide-linux-x64-gnu --legacy-peer-deps --no-audit --no-fund; \
  npm rebuild esbuild bcrypt node-pty sharp; \
  node scripts/sync-mathjax-assets.cjs; \
  npm cache clean --force
RUN set -eux; \
  corepack enable; \
  retry_pnpm() { \
  attempt=1; \
  while [ "$attempt" -le 3 ]; do \
  if "$@"; then \
  return 0; \
  fi; \
  if [ "$attempt" -eq 3 ]; then \
  return 1; \
  fi; \
  sleep_seconds=$((attempt * 15)); \
  echo "pnpm command failed on attempt ${attempt}; retrying in ${sleep_seconds}s..." >&2; \
  sleep "$sleep_seconds"; \
  attempt=$((attempt + 1)); \
  done; \
  }; \
  corepack prepare "$(node -p "require('./server/openclaw/package.json').packageManager")" --activate; \
  retry_pnpm pnpm --dir server/openclaw install --frozen-lockfile; \
  pnpm --dir server/openclaw canvas:a2ui:bundle || \
  (echo "A2UI bundle: creating stub (non-fatal)" && \
  mkdir -p server/openclaw/src/canvas-host/a2ui && \
  printf '/* A2UI bundle unavailable in this build */\n' > server/openclaw/src/canvas-host/a2ui/a2ui.bundle.js && \
  printf 'stub\n' > server/openclaw/src/canvas-host/a2ui/.bundle.hash && \
  rm -rf server/openclaw/vendor/a2ui server/openclaw/apps/shared/OpenClawKit/Tools/CanvasA2UI); \
  pnpm --dir server/openclaw build:docker
# Build client and server assets
ARG APP_VERSION=dev
ARG APP_SHA=dev
ARG IMAGE_TAG=dev
ARG BUILD_TIMESTAMP=unknown
ENV NODE_ENV=production
ENV VITE_APP_VERSION=$APP_VERSION
ENV APP_VERSION=$APP_VERSION
ENV APP_SHA=$APP_SHA
ENV IMAGE_TAG=$IMAGE_TAG
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV CI=true
RUN npm run build

# Convert to production-only deps for runtime images
RUN npm prune --legacy-peer-deps --omit=dev
RUN node -e "console.log(require.resolve('ajv/package.json'))"
RUN node -e "console.log(require.resolve('ajv/package.json'))"
# ============================================
# Stage 2: Sandbox Runner
# ============================================
FROM node:22-slim AS sandbox-runner
WORKDIR /app

# Bake APP_VERSION into the image so runtime can report the deployed commit SHA
# even if docker-compose environment expansion is missing/misconfigured.
ARG APP_VERSION=dev
ARG APP_SHA=dev
ARG IMAGE_TAG=dev
ARG BUILD_TIMESTAMP=unknown
ENV APP_VERSION=$APP_VERSION
ENV APP_SHA=$APP_SHA
ENV IMAGE_TAG=$IMAGE_TAG
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV RELEASE_MANIFEST_PATH=/app/dist/release-manifest.json

# docker CLI (runner executes docker-run jobs via /var/run/docker.sock)
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
ARG DOCKER_CLI_VERSION=29.2.1
RUN curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" | tar -xz -C /tmp && mv /tmp/docker/docker /usr/local/bin/docker && chmod +x /usr/local/bin/docker && docker --version

ENV NODE_ENV=production
ENV SANDBOX_RUNNER_PORT=8080

# Runtime deps + built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/openclaw ./server/openclaw

EXPOSE 8080

CMD ["node", "dist/sandbox-runner.cjs"]

# ============================================
# Stage 3: Production Runner
# ============================================
FROM node:22-slim AS runner
WORKDIR /app

# Bake APP_VERSION into the image (source of truth for /api/health version).
ARG APP_VERSION=dev
ARG APP_SHA=dev
ARG IMAGE_TAG=dev
ARG BUILD_TIMESTAMP=unknown
ENV APP_VERSION=$APP_VERSION
ENV APP_SHA=$APP_SHA
ENV IMAGE_TAG=$IMAGE_TAG
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV RELEASE_MANIFEST_PATH=/app/dist/release-manifest.json

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs iliagpt

ENV NODE_ENV=production
ENV PORT=5000

# Install Playwright Chromium system dependencies + wget for healthcheck + python3/matplotlib for Code Interpreter.
# These are the shared libraries Playwright's bundled Chromium needs on Debian.
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  wget ca-certificates fonts-liberation \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
  libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 \
  libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
  libxkbcommon0 libxrandr2 libxshmfence1 xdg-utils \
  libxtst6 \
  libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 libpangocairo-1.0-0 \
  python3 python3-matplotlib \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
# Copy prod dependencies only (with ownership)
COPY --chown=iliagpt:nodejs --from=builder /app/node_modules ./node_modules
# Copy built artifacts
COPY --chown=iliagpt:nodejs --from=builder /app/dist ./dist
COPY --chown=iliagpt:nodejs --from=builder /app/migrations ./migrations
COPY --chown=iliagpt:nodejs --from=builder /app/client/public ./client/public
COPY --chown=iliagpt:nodejs --from=builder /app/package.json ./package.json
COPY --chown=iliagpt:nodejs --from=builder /app/server/openclaw ./server/openclaw

# Download Playwright's bundled Chromium browser binary.
# System deps are installed above via apt-get; here we only fetch the browser.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
RUN node ./node_modules/playwright/cli.js install chromium \
  && chown -R iliagpt:nodejs /app/.playwright-browsers

# Create temp directories for uploads/sandbox/logs with correct permissions
RUN mkdir -p /app/uploads /app/artifacts /app/sandbox_workspace /app/data /app/logs \
  && chown -R iliagpt:nodejs /app/uploads /app/artifacts /app/sandbox_workspace /app/data /app/logs

USER iliagpt

EXPOSE 5000

# Health check (use IPv4 to avoid localhost -> ::1 issues)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.cjs"]
