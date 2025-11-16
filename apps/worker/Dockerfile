# Production Dockerfile for Quorum Worker using Bun

FROM oven/bun:1.3.2 AS base
WORKDIR /app

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/recorder/package.json ./packages/recorder/
COPY packages/encoder/package.json ./packages/encoder/
COPY apps/worker/package.json ./apps/worker/

RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS builder
COPY package.json bun.lockb ./
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY packages/recorder ./packages/recorder
COPY packages/encoder ./packages/encoder
COPY apps/worker ./apps/worker
COPY turbo.json ./

RUN bun install --frozen-lockfile
RUN bun run build

# Install Playwright browsers
RUN bunx playwright install chromium

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
COPY --from=builder --chown=bunjs:bunjs /app/packages/recorder ./packages/recorder
COPY --from=builder --chown=bunjs:bunjs /app/packages/encoder ./packages/encoder
COPY --from=builder --chown=bunjs:bunjs /app/apps/worker ./apps/worker
COPY --from=builder --chown=bunjs:bunjs /root/.cache/ms-playwright /home/bunjs/.cache/ms-playwright

# Create directories for recordings
RUN mkdir -p /app/recordings /app/temp && \
    chown -R bunjs:bunjs /app/recordings /app/temp

USER bunjs

CMD ["bun", "run", "apps/worker/src/index.ts"]
