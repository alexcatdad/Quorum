# Quorum - Distributed Meeting Recording System

A production-ready, multi-tenant SaaS application for automated recording of Microsoft Teams, Slack Huddles, and YouTube streams/meetings.

## Features

✅ **Multi-Platform Recording**
- Microsoft Teams meetings
- Slack Huddles
- YouTube live streams

✅ **Production-Ready Infrastructure**
- Elysia API server with OpenAPI/Swagger documentation
- BullMQ job queue system with Redis
- Playwright-based browser automation
- FFmpeg VP9 video encoding
- MinIO S3-compatible object storage
- PostgreSQL database with Prisma ORM

✅ **Security & Compliance**
- JWT-based authentication
- Multi-tenant isolation
- Role-based access control (RBAC)
- GDPR data export/deletion
- Comprehensive audit logging
- 30-day automatic retention policy

✅ **Observability**
- Structured logging with Pino
- Prometheus metrics
- Grafana dashboards
- Sentry error tracking
- Health check endpoints

✅ **DevOps**
- GitHub Actions CI/CD pipeline
- Docker containers (Bun-based)
- Kubernetes deployment manifests
- Comprehensive test coverage
- Automated backups

## Quick Start

### Prerequisites

- Bun 1.3.2+
- Docker & Docker Compose

### 1. Install Dependencies

```bash
bun install
```

### 2. Start Infrastructure

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on `localhost:54320`
- Redis on `localhost:63790`
- MinIO API on `localhost:9100`, Console on `localhost:9101`

### 3. Run Database Migrations

```bash
cd packages/db
bunx prisma migrate deploy
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 5. Start Services

```bash
# Terminal 1: API Server
cd apps/api
bun run dev

# Terminal 2: Worker
cd apps/worker
bun run dev
```

### 6. Access Services

- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/swagger
- **Metrics**: http://localhost:3000/metrics
- **MinIO Console**: http://localhost:9101 (minioadmin/minioadmin)
