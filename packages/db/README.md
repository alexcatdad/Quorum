# @quorum/db

Database package for the Quorum meeting recorder system using Prisma ORM and PostgreSQL.

## Overview

This package provides a complete database schema and client for managing the multi-tenant meeting recording system. It includes all entities, relationships, and migrations needed for the Quorum application.

## Schema Entities

### Core Entities

#### Organization

Multi-tenant root entity that owns all other resources.

- `id`: Unique identifier (CUID)
- `name`: Organization name
- `slug`: URL-safe unique identifier
- `createdAt`, `updatedAt`: Timestamps

#### User

Authenticated individuals with role-based access.

- `id`, `email`, `name`: User identification
- `organizationId`: Foreign key to Organization
- `role`: ADMIN, MEMBER, or VIEWER
- `createdAt`, `updatedAt`: Timestamps

#### BotAccount

Platform credentials for automated recording.

- `id`: Unique identifier
- `organizationId`: Foreign key to Organization
- `platform`: TEAMS, SLACK, or YOUTUBE
- `credentials`: JSON field for encrypted authentication state
- `isActive`: Boolean flag
- `createdAt`, `updatedAt`: Timestamps

#### Meeting

Recording session entity.

- `id`: Unique identifier
- `organizationId`: Foreign key to Organization
- `botAccountId`: Optional foreign key to BotAccount
- `platform`: TEAMS, SLACK, or YOUTUBE
- `url`: Meeting URL
- `scheduledStart`, `scheduledEnd`: DateTime fields
- `duration`: Meeting duration in minutes (nullable)
- `status`: PENDING, RECORDING, PROCESSING, READY, or FAILED
- `containerId`: Docker container ID for active recording
- `error`: Error message if status is FAILED
- `createdAt`, `updatedAt`: Timestamps

#### Recording

Completed recording artifacts.

- `id`: Unique identifier
- `meetingId`: Unique foreign key to Meeting (1-to-1)
- `organizationId`: Foreign key to Organization
- `rawVideoUrl`, `encodedVideoUrl`, `harFileUrl`: Storage URLs
- `rawVideoSize`, `encodedVideoSize`: File sizes in bytes (BigInt)
- `encodingStatus`: PENDING, PROCESSING, READY, or FAILED
- `encodingError`: Error message if encoding failed
- `metadata`: JSON field for participant info and meeting metadata
- `createdAt`, `updatedAt`, `deletedAt`: Timestamps (soft delete support)

#### AuditLog

Track all system operations for compliance and debugging.

- `id`: Unique identifier
- `organizationId`: Foreign key to Organization
- `userId`: Optional foreign key to User (nullable for system actions)
- `action`: Action identifier (e.g., "meeting.created")
- `entity`: Entity type (e.g., "Meeting")
- `entityId`: ID of affected entity
- `changes`: JSON field for before/after changes
- `ipAddress`, `userAgent`: Request metadata
- `createdAt`: Timestamp

## Indexes

All tables include strategic indexes for:

- Foreign keys (`organizationId`, `userId`, etc.)
- Status fields for filtering
- Timestamps for sorting and range queries
- Unique constraints where appropriate

## Usage

### Import the database client

```typescript
import { prisma } from "@quorum/db";

// Query organizations
const orgs = await prisma.organization.findMany();

// Create a meeting
const meeting = await prisma.meeting.create({
  data: {
    organizationId: "org-id",
    platform: "TEAMS",
    url: "https://teams.microsoft.com/l/meetup-join/...",
    scheduledStart: new Date(),
    status: "PENDING",
  },
});
```

### Import types

```typescript
import { Organization, User, Meeting, UserRole, Platform } from "@quorum/db";
```

## Scripts

- `bun run db:migrate:dev` - Create and apply new migrations in development
- `bun run db:migrate:deploy` - Apply migrations in production
- `bun run db:generate` - Generate Prisma client
- `bun run db:studio` - Open Prisma Studio (database GUI)
- `bun run db:push` - Push schema changes without migrations (dev only)

## Testing

Run the connection test:

```bash
bun run src/test-connection.ts
```

This will:

1. Verify database connection
2. Create test organization, user, and meeting
3. Query with relations
4. Clean up test data

## Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/database?schema=public"
```

## Multi-tenancy

All entities (except User and AuditLog which reference Organization) include an `organizationId` field to ensure proper data isolation. Always filter queries by organization:

```typescript
// Good - filters by organization
const meetings = await prisma.meeting.findMany({
  where: { organizationId: userOrgId },
});

// Bad - returns all meetings across all organizations
const meetings = await prisma.meeting.findMany();
```

## Migrations

Migrations are stored in `prisma/migrations/`. The initial migration creates all tables, indexes, enums, and foreign key constraints.

To create a new migration:

```bash
bunx prisma migrate dev --name description_of_changes
```

## Production Deployment

1. Ensure DATABASE_URL is set in production environment
2. Run migrations: `bunx prisma migrate deploy`
3. Generate client: `bunx prisma generate`

## Database Schema Diagram

```
Organizations
    ├── Users (many)
    ├── BotAccounts (many)
    ├── Meetings (many)
    │   └── Recording (one)
    ├── Recordings (many)
    └── AuditLogs (many)
```

## Notes

- All foreign keys use CASCADE delete for organization-owned entities
- Soft delete support on Recordings via `deletedAt` field
- JSON fields for flexible storage of credentials and metadata
- CUID for all primary keys
- Timestamp fields use PostgreSQL TIMESTAMP(3) for millisecond precision
