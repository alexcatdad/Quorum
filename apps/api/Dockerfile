# Production Dockerfile for Quorum API using Bun

FROM oven/bun:1.3.2-slim AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS builder
COPY package.json bun.lockb ./
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY turbo.json ./

RUN bun install --frozen-lockfile
RUN bun run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 bunjs && \
    adduser --system --uid 1001 bunjs

# Copy node_modules and built files
COPY --from=deps --chown=bunjs:bunjs /app/node_modules ./node_modules
COPY --from=builder --chown=bunjs:bunjs /app/packages/db ./packages/db
COPY --from=builder --chown=bunjs:bunjs /app/packages/shared ./packages/shared
COPY --from=builder --chown=bunjs:bunjs /app/apps/api ./apps/api

USER bunjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

CMD ["bun", "run", "apps/api/src/index.ts"]
