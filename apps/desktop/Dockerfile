# ══════════════════════════════════════════════════════════════
# Izzi AI Desktop — Production Dockerfile
# Multi-stage build for cross-platform consistency
# ══════════════════════════════════════════════════════════════

# ── Stage 1: Builder ──
FROM node:20-alpine AS builder

WORKDIR /app

# Install system deps for native modules
RUN apk add --no-cache python3 make g++ git

# Copy workspace root configs
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY turbo.json ./

# Copy desktop app
COPY apps/desktop/ apps/desktop/

# Install dependencies
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    pnpm install --frozen-lockfile --filter @openclaw/desktop...

# Build desktop app (renderer only — Electron main is built at package time)
RUN cd apps/desktop && pnpm run build

# ── Stage 2: Runtime (for AI bot sidecar) ──
FROM node:20-alpine AS runtime

WORKDIR /app

# Security: create non-root user
RUN addgroup -S openclaw && adduser -S openclaw -G openclaw

# Copy built assets
COPY --from=builder /app/apps/desktop/dist/ ./dist/
COPY --from=builder /app/apps/desktop/package.json ./

# Install production deps only
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    pnpm install --prod --frozen-lockfile

# Environment
ENV NODE_ENV=production
ENV OPENCLAW_DATA_DIR=/data

# Create data directory
RUN mkdir -p /data && chown -R openclaw:openclaw /data

USER openclaw

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main/index.js"]
