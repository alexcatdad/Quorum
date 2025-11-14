# Meeting Recorder System - Technical Architecture Document

**Version**: 1.0  
**Date**: 2025-01-15  
**Status**: Architecture Proposal

---

## Executive Summary

This document outlines the technical architecture for a distributed meeting recording system capable of orchestrating multiple concurrent browser-based recording sessions. The system supports Microsoft Teams and Slack Huddles, with automated video encoding, object storage, and multi-tenant access control.

**Key Capabilities**:

- Concurrent recording of 4-5 meetings with horizontal scalability
- Automated VP9 video encoding for optimal storage efficiency
- Multi-tenant architecture with OAuth-based authentication
- RESTful API with web-based management interface
- 30-day automated retention with on-demand deletion
- Separate encoding pipeline for resource optimization

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Organization Layer                     │
│            (Multi-tenant isolation via Prisma)           │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────┐
         │   Orchestrator Service   │
         │   (Elysia + BullMQ)      │
         │   - API Gateway          │
         │   - Job Scheduler        │
         │   - Container Manager    │
         │   - Web Dashboard        │
         └────┬──────────────┬───────┘
              │              │
        ┌─────▼────┐    ┌────▼─────┐
        │PostgreSQL│    │  Redis   │
        │(Managed) │    │ (+BullMQ)│
        └──────────┘    └────┬─────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐  ┌─────▼─────┐  ┌────▼──────┐
        │ Recording │  │ Recording │  │ Encoding  │
        │ Worker 1  │  │ Worker 2  │  │  Service  │
        └─────┬─────┘  └─────┬─────┘  └────┬──────┘
              │              │              │
              └──────────────┴──────────────┘
                        │
                  ┌─────▼─────┐
                  │   MinIO   │
                  │  (S3 API) │
                  └───────────┘
```

### 1.2 Component Responsibilities

**Orchestrator Service**:

- RESTful API for meeting management (Elysia framework)
- OAuth authentication and authorization (Zitadel/WorkOS)
- BullMQ job queue management (recording + encoding queues)
- Dynamic Docker container lifecycle management
- PostgreSQL state persistence via Prisma ORM
- Web dashboard for recording management

**Recording Worker** (ephemeral containers):

- Platform-specific Playwright automation (Teams/Slack)
- Browser-based audio/video capture
- Network request capture (HAR format)
- Raw video upload to MinIO (VP8 codec)
- Redis heartbeat publication
- Automatic cleanup on completion

**Encoding Service**:

- Asynchronous VP9 video re-encoding
- FFmpeg-based transcoding (CRF 31 for compression)
- MinIO artifact management
- Status reporting via Redis events

**Data Stores**:

- **PostgreSQL**: Persistent state (meetings, recordings, users, organizations)
- **Redis**: Job queue (BullMQ), worker heartbeats, pub/sub events
- **MinIO**: Object storage (videos, network captures, metadata)

---

## 2. Technology Stack

### 2.1 Core Technologies

| Component              | Technology                                 | Justification                                                                 |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| **Runtime**            | Bun 1.x                                    | 4x faster startup than Node.js, native TypeScript, excellent performance      |
| **Monorepo**           | Bun Workspaces + Turborepo                 | Efficient code sharing, incremental builds, type safety across packages       |
| **API Framework**      | Elysia                                     | Built for Bun, fastest framework, end-to-end type safety, built-in validation |
| **ORM**                | Prisma                                     | Mature ecosystem, type-safe queries, excellent migration tooling              |
| **Job Queue**          | BullMQ + Redis                             | Production-grade reliability, built-in retries, cron scheduling               |
| **Browser Automation** | Playwright                                 | Industry standard, built-in video recording, cross-browser support            |
| **Authentication**     | OAuth 2.0 (Zitadel/WorkOS)                 | Enterprise-ready, OIDC compliance, multi-tenant support                       |
| **Database**           | PostgreSQL 16                              | ACID compliance, managed backup, JSON support for metadata                    |
| **Object Storage**     | MinIO                                      | S3-compatible API, self-hosted, lifecycle policies                            |
| **Container Runtime**  | Docker + Compose (dev) / Kubernetes (prod) | Industry standard, orchestration flexibility                                  |

### 2.2 Monorepo Structure

```
meeting-recorder/
├── packages/
│   ├── orchestrator/      # Main API + BullMQ processor
│   ├── worker-base/       # Shared recording logic
│   ├── worker-teams/      # Microsoft Teams automation
│   ├── worker-slack/      # Slack Huddles automation (Phase 2)
│   ├── shared/            # Types, utilities, configs
│   └── db/                # Prisma schema + migrations
├── apps/
│   └── dashboard/         # Web UI (React/Vue TBD)
├── docker-compose.yml
├── turbo.json
└── package.json
```

---

## 3. Key Technical Decisions

### 3.1 Separate Encoding Pipeline

**Decision**: Decouple video encoding from recording workers.

**Rationale**:

- **Resource Efficiency**: Workers exit quickly (5-10 min post-meeting), encoding runs separately (10-15 min)
- **Independent Scaling**: Can run 5 recorders with 2 encoders based on workload
- **Retry Capability**: Encoding failures don't require re-recording
- **Future Flexibility**: Easy codec changes (AV1, H.265) without worker modifications

**Implementation**: BullMQ encoding queue processed by dedicated service.

### 3.2 VP9 Video Codec

**Decision**: Record in VP8 (Playwright default), re-encode to VP9 for storage.

**Rationale**:

- **40% Storage Reduction**: VP9 @ CRF 31 vs VP8 (900MB/hr vs 1.5GB/hr)
- **Network Efficiency**: Smaller uploads to MinIO, reduced bandwidth costs
- **Browser Compatibility**: Chrome/Firefox native playback support
- **Cost Analysis**: 150 hours/month = 90GB saved = significant cost reduction over time

**Trade-off**: Additional CPU cost during encoding (acceptable for offline processing).

### 3.3 Stateless Workers

**Decision**: Workers have no database access, communicate only via Redis.

**Rationale**:

- **Simplicity**: Workers are disposable compute units
- **Security**: Reduced attack surface (no DB credentials in workers)
- **Scalability**: No connection pool exhaustion
- **Clear Boundaries**: Orchestrator owns all state management

### 3.4 Multi-Tenancy via Row-Level Filtering

**Decision**: Single database with `organizationId` on all tables, enforced in application layer.

**Rationale**:

- **Cost Efficiency**: Single infrastructure for all tenants
- **Operational Simplicity**: One database to manage, backup, scale
- **Data Isolation**: Prisma middleware enforces organization scoping
- **Compliance**: Audit logs track cross-tenant access

**Security**: All queries automatically scoped by authenticated user's organization.

### 3.5 OAuth Authentication

**Decision**: Implement Zitadel or WorkOS OAuth provider from Phase 1.

**Rationale**:

- **Enterprise Requirement**: OIDC/SAML support for customer SSO
- **Security Best Practice**: Industry-standard authentication flows
- **Developer Velocity**: Minimal code (~50 lines with Elysia JWT plugin)
- **Future-Proofing**: Enables directory sync, SCIM, advanced features

**Alternative Considered**: API keys rejected due to lack of user context and enterprise features.

---

## 4. Data Model

### 4.1 Core Entities

**Organization**: Multi-tenant isolation boundary

- `id`, `name`, `slug`
- Owns users, meetings, bot accounts

**User**: Authenticated individuals

- Links to organization
- Role-based access (Admin, Member, Viewer)

**BotAccount**: Platform-specific automation credentials

- One per platform per organization
- Encrypted storage of authentication state
- Reusable across all meetings

**Meeting**: Recording session definition

- Scheduled start/end times
- Platform (Teams/Slack)
- Status tracking (Pending → Recording → Completed)
- Links to recording output

**Recording**: Completed recording artifacts

- Video URLs (raw + encoded)
- Network capture (HAR file)
- Encoding status tracking
- Participant metadata

**WorkerHeartbeat**: Real-time worker health monitoring

- Last heartbeat timestamp
- Status JSON (phase, CPU, memory)

### 4.2 Data Retention

- **Recordings**: 30-day lifecycle policy (MinIO automatic deletion)
- **Metadata**: Retained in PostgreSQL indefinitely (or per compliance requirements)
- **On-Demand Deletion**: Manual deletion available via API/UI
- **Audit Logs**: Permanent retention for compliance

---

## 5. Infrastructure Requirements

### 5.1 Resource Allocation

**Per Recording Worker**:

- CPU: 1.5 cores
- Memory: 3GB RAM
- Shared Memory: 2GB (for browser processes)
- Disk: Ephemeral (uploads directly to MinIO)

**Encoding Service**:

- CPU: 2 cores
- Memory: 2GB RAM
- Disk: 10GB temporary space

**Concurrent Capacity** (5 simultaneous recordings):

- Total CPU: ~10 cores (5 workers × 1.5 + 2 encoder + 1 orchestrator)
- Total Memory: ~20GB (5 workers × 3GB + 2GB encoder + 3GB services)
- Network: Moderate (streaming uploads to MinIO)

**Recommended Hardware**: 32GB RAM, 12-core CPU for headroom

### 5.2 Deployment Environments

**Development** (Docker Compose):

- Single-node deployment
- All services on localhost
- Shared Docker network
- Volume-based persistence

**Production** (Kubernetes):

- Multi-node cluster in data center
- Managed PostgreSQL (automated backups)
- Redis with AOF persistence
- MinIO distributed across nodes
- Horizontal pod autoscaling for workers

---

## 6. Security Considerations

### 6.1 Credential Management

**Phase 1**: Docker Secrets (file-based secrets mounted at runtime)
**Production**: Migrate to Vault or cloud provider secrets manager

**Stored Credentials**:

- Bot account authentication state (encrypted)
- MinIO access keys
- Database connection strings
- OAuth client secrets

### 6.2 Access Control

**API Authentication**: OAuth 2.0 JWT tokens (validated per request)
**Organization Isolation**: All queries filtered by `organizationId`
**Recording Access**: Pre-signed MinIO URLs with 1-hour expiration
**Audit Logging**: All create/update/delete operations tracked

### 6.3 Network Security

**Container Isolation**: Workers on dedicated Docker network
**No Public Exposure**: Workers communicate only with orchestrator services
**TLS**: All external communication encrypted (HTTPS, WSS)

---

## 7. Phase 1 Deliverables

### 7.1 In-Scope Features

**Core Infrastructure**:

- [x] Bun monorepo with Turborepo build orchestration
- [x] Docker Compose environment (Postgres, Redis, MinIO)
- [x] Prisma schema with multi-tenant support
- [x] OAuth authentication (Zitadel or WorkOS)

**Orchestrator Service**:

- [x] Elysia REST API with OpenAPI documentation
- [x] BullMQ job queues (recording + encoding)
- [x] Docker container lifecycle management
- [x] Worker heartbeat monitoring
- [x] Web dashboard UI for recording management

**Recording Capability**:

- [x] Microsoft Teams worker implementation
- [x] YouTube recording test scenario (5-minute rickroll)
- [x] Playwright video capture (VP8 codec)
- [x] Network request capture (HAR format)
- [x] MinIO upload pipeline

**Encoding Pipeline**:

- [x] Separate encoding service/queue
- [x] FFmpeg VP9 re-encoding (CRF 31)
- [x] Status tracking and error handling

**Web Dashboard**:

- [x] List active recordings (live status)
- [x] List completed recordings
- [x] Video playback (embedded player with MinIO URLs)
- [x] Manual recording trigger
- [x] On-demand deletion

### 7.2 Deferred to Phase 2

**Slack Huddles Support**:

- Requires different automation approach than Teams
- Web client limitations need investigation
- May require Slack API integration

**Advanced Features**:

- Network capture parsing (participant detection, transcript extraction)
- Real-time transcript streaming
- Multi-signal meeting end detection (DOM + network + timeout)
- Automatic retry logic for worker failures
- Advanced encoding options (H.265, AV1, bitrate presets)
- Worker failure recovery strategies

**Operational Enhancements**:

- Prometheus metrics and Grafana dashboards
- Structured logging with centralized aggregation
- Kubernetes production deployment manifests
- CI/CD pipeline automation
- Load testing and performance benchmarking

---

## 8. Testing Strategy

### 8.1 Phase 1 Test Scenarios

**Scenario 1: End-to-End Recording Flow**

```
Given: Orchestrator is running with all services healthy
When: User creates meeting via API (YouTube rickroll URL, 5-minute duration)
Then:
  - Meeting record created in PostgreSQL (status: PENDING)
  - BullMQ job scheduled for immediate start
  - Worker container spawned within 10 seconds
  - Browser navigates to YouTube URL
  - Video recording starts (Playwright)
  - Worker publishes heartbeat to Redis every 10 seconds
  - After 5 minutes, recording stops
  - Raw video (VP8) uploaded to MinIO
  - Recording status updated to PROCESSING
  - Encoding job queued in BullMQ
  - Encoder downloads, re-encodes to VP9
  - Optimized video uploaded to MinIO
  - Recording status updated to READY
  - Video playable in web dashboard
  - Worker container cleaned up
```

**Scenario 2: Multi-Tenant Isolation**

```
Given: Two organizations (Org A, Org B) exist in system
When: User from Org A authenticates and creates meeting
Then:
  - Meeting associated with Org A
  - User from Org B cannot see Org A's meeting in API
  - User from Org B cannot access Org A's recording URL
  - Audit log records Org A user's action
```

**Scenario 3: Worker Heartbeat Monitoring**

```
Given: Recording in progress (worker container running)
When: Worker publishes heartbeat every 10 seconds
Then:
  - WorkerHeartbeat record updated in Redis
  - Dashboard shows "Recording" status with live indicator
  - If no heartbeat for 60 seconds, orchestrator marks worker as stale
  - Orchestrator can optionally kill stale containers
```

**Scenario 4: Encoding Pipeline**

```
Given: Raw video (VP8) uploaded to MinIO after recording
When: Encoding job dequeued from BullMQ
Then:
  - Encoder downloads raw video from MinIO
  - FFmpeg re-encodes to VP9 (CRF 31)
  - File size reduced by ~40% (validated)
  - Optimized video uploaded to MinIO
  - Original raw video optionally deleted
  - Recording status updated to READY
  - If encoding fails, job retries (max 3 attempts)
```

**Scenario 5: OAuth Authentication**

```
Given: Zitadel/WorkOS configured with OIDC
When: User accesses dashboard without token
Then: Redirected to OAuth provider login
When: User completes OAuth flow
Then:
  - JWT token received with user claims (sub, org_id)
  - Token stored in browser (cookie/localStorage)
  - Subsequent API requests include token in Authorization header
  - Orchestrator validates token signature
  - Requests scoped to user's organization
```

### 8.2 Integration Test Coverage

**API Endpoints**:

- POST /meetings (create scheduled recording)
- GET /meetings (list with organization filter)
- GET /meetings/:id (single meeting details)
- DELETE /meetings/:id (cancel/delete)
- GET /recordings (list with organization filter)
- GET /recordings/:id (metadata)
- GET /recordings/:id/video (MinIO pre-signed URL)
- DELETE /recordings/:id (delete artifacts)

**BullMQ Job Processing**:

- Recording job enqueue/dequeue
- Encoding job enqueue/dequeue
- Job retry on transient failures
- Job failure on non-retryable errors
- Scheduled job execution (cron-based)

**Docker Container Management**:

- Container spawn with environment variables
- Container network connectivity
- Volume mounts (shared, read-only, read-write)
- Container cleanup on completion
- Container health checks

**OAuth Flow**:

- Authorization code exchange
- Token validation (signature, expiration)
- Token refresh (if supported)
- Logout/revocation

---

## 9. Operational Considerations

### 9.1 Monitoring & Observability

**Health Checks**:

- Orchestrator: `/health` endpoint (DB, Redis, MinIO connectivity)
- Workers: Container-level health checks (HTTP probe)
- Encoder: Job queue depth monitoring

**Logging**:

- Structured JSON logs (Pino library)
- Container stdout/stderr captured by Docker
- Centralized aggregation (future: Loki/ELK)

**Metrics** (future):

- Active recording count
- Encoding queue length
- Storage usage (MinIO)
- Worker success/failure rate
- Average encoding duration

### 9.2 Disaster Recovery

**Data Backup**:

- PostgreSQL: Managed service automated backups
- MinIO: Erasure coding (production), single-node (dev)
- Redis: AOF persistence (durable even on power loss)

**Recovery Procedures**:

- Database restore from backup (managed service)
- MinIO data replication (if configured)
- BullMQ job reconstruction from PostgreSQL state

---

## 10. Success Criteria

**Functional Requirements**:

- ✅ Successfully record 5-minute YouTube video
- ✅ Video uploaded to MinIO and playable in dashboard
- ✅ Encoding reduces file size by ≥35%
- ✅ Multi-tenant isolation verified (no cross-org data leakage)
- ✅ OAuth authentication functional end-to-end
- ✅ Worker heartbeat monitoring operational
- ✅ All API endpoints respond correctly with proper auth

**Non-Functional Requirements**:

- ✅ Worker container startup < 15 seconds
- ✅ Encoding completes within 2x recording duration
- ✅ API response time < 500ms (p95)
- ✅ System handles 5 concurrent recordings without degradation
- ✅ Zero data loss on power failure (AOF + managed DB)

---

## 11. Risks & Mitigations

| Risk                         | Impact                    | Mitigation                                               |
| ---------------------------- | ------------------------- | -------------------------------------------------------- |
| **Platform UI changes**      | Worker automation breaks  | Version-lock Playwright selectors, monitoring alerts     |
| **OAuth provider downtime**  | Users cannot authenticate | Implement token caching, graceful degradation            |
| **MinIO storage exhaustion** | Cannot upload recordings  | Lifecycle policies, monitoring alerts, storage quotas    |
| **Worker container failure** | Recording lost            | Heartbeat monitoring, automatic restart (Phase 2)        |
| **Encoding CPU saturation**  | Queue backlog             | Independent scaling, priority queue (VIP meetings first) |
| **Redis data loss**          | Jobs lost on restart      | AOF persistence enabled, PostgreSQL as source of truth   |

---

## 12. Future Considerations

**Scalability**:

- Kubernetes HorizontalPodAutoscaler for workers
- Multi-region MinIO deployment
- Read replicas for PostgreSQL
- Redis Cluster for high availability

**Features**:

- Live transcription integration (Whisper, Deepgram)
- AI-powered meeting summarization
- Speaker diarization and participant identification
- Calendar integration (Google Calendar, Outlook)
- Webhook notifications (recording complete, failure alerts)
- Custom branding and white-label support

**Compliance**:

- GDPR data export and deletion
- SOC 2 audit readiness
- Encryption at rest (MinIO, PostgreSQL)
- Role-based access control (RBAC) refinement

---

## Appendix A: Technology Evaluation Matrix

| Criteria      | Bun          | Node.js          | Deno         |
| ------------- | ------------ | ---------------- | ------------ |
| Startup Speed | ✅ 4x faster | Baseline         | ✅ 2x faster |
| TypeScript    | ✅ Native    | Requires tooling | ✅ Native    |
| Ecosystem     | 🟡 Growing   | ✅ Mature        | 🟡 Limited   |
| Performance   | ✅ Fastest   | Baseline         | ✅ Fast      |
| **Selected**  | **✅**       | ❌               | ❌           |

| Criteria     | Elysia           | Hono          | Express       |
| ------------ | ---------------- | ------------- | ------------- |
| Bun Native   | ✅ Built for Bun | 🟡 Compatible | 🟡 Compatible |
| Type Safety  | ✅ End-to-end    | 🟡 Partial    | ❌ None       |
| Performance  | ✅ Fastest       | ✅ Fast       | Baseline      |
| Ecosystem    | 🟡 Growing       | 🟡 Growing    | ✅ Mature     |
| **Selected** | **✅**           | ❌            | ❌            |

---

## Appendix B: Glossary

**BullMQ**: Redis-based job queue library with retry logic and scheduling
**CRF**: Constant Rate Factor - quality setting for video encoding (lower = better)
**HAR**: HTTP Archive Format - captures network requests/responses
**JWT**: JSON Web Token - standard for authentication
**MinIO**: S3-compatible object storage server
**OAuth 2.0**: Industry-standard authorization framework
**OIDC**: OpenID Connect - identity layer on top of OAuth 2.0
**Playwright**: Browser automation library by Microsoft
**Prisma**: Type-safe ORM for TypeScript/JavaScript
**VP8/VP9**: Video codecs (VP9 is newer, better compression)
**WebRTC**: Real-time communication protocol used by meeting platforms
**Xvfb**: X Virtual Framebuffer - headless display server for browsers

---

**Document End**
