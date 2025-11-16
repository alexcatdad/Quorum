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

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
