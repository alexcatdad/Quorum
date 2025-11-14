# Quorum - Docker Infrastructure Guide

This guide covers the Docker-based development infrastructure for the Quorum meeting recorder application.

## Overview

The Docker Compose setup provides three core infrastructure services:

- **PostgreSQL 16**: Primary database for application data
- **Redis 7**: Caching and queue management
- **MinIO**: S3-compatible object storage for recordings

All services are configured for development use with sensible defaults and automatic initialization.

## Quick Start

### Prerequisites

- Docker Desktop or Docker Engine (20.10+)
- Docker Compose (2.0+)

### Initial Setup

1. **Copy environment configuration**:

   ```bash
   cp .env.example .env
   ```

2. **Start all services**:

   ```bash
   docker compose up -d
   ```

3. **Verify services are healthy**:

   ```bash
   docker compose ps
   ```

   All services should show as "healthy" after 10-30 seconds.

4. **View logs** (optional):
   ```bash
   docker compose logs -f
   ```

## Service Details

### PostgreSQL Database

- **Port**: 5432
- **Database**: quorum
- **User**: quorum
- **Password**: quorum_dev (⚠️ change in production!)
- **Connection String**: `postgresql://quorum:quorum_dev@localhost:5432/quorum`

**Access the database**:

```bash
# Using Docker exec
docker compose exec postgres psql -U quorum -d quorum

# Using local psql client
psql postgresql://quorum:quorum_dev@localhost:5432/quorum
```

**Common commands**:

```sql
-- List all databases
\l

-- List all tables
\dt

-- Describe a table
\d table_name

-- Exit
\q
```

### Redis Cache

- **Port**: 6379
- **Persistence**: AOF enabled with 1-second fsync
- **Connection String**: `redis://localhost:6379/0`

**Access Redis**:

```bash
# Using Docker exec
docker compose exec redis redis-cli

# Using local redis-cli
redis-cli -h localhost -p 6379
```

**Common commands**:

```bash
# Ping server
PING

# Get all keys
KEYS *

# Get a value
GET key_name

# Clear all data (⚠️ destructive!)
FLUSHALL
```

### MinIO Object Storage

- **API Port**: 9000
- **Console Port**: 9001
- **Access Key**: minioadmin
- **Secret Key**: minioadmin (⚠️ change in production!)
- **Console URL**: http://localhost:9001

**Pre-configured buckets**:

- `recordings-raw`: Original uploaded recordings
- `recordings-encoded`: Transcoded/optimized recordings
- `recordings-har`: HTTP Archive files

**Access MinIO Console**:

1. Open http://localhost:9001 in your browser
2. Login with credentials: minioadmin / minioadmin
3. Browse buckets and files

**Using MinIO Client (mc)**:

```bash
# Configure alias
mc alias set local http://localhost:9000 minioadmin minioadmin

# List buckets
mc ls local

# List files in a bucket
mc ls local/recordings-raw

# Upload a file
mc cp myfile.mp4 local/recordings-raw/
```

## Common Operations

### Start Services

```bash
# Start all services in background
docker compose up -d

# Start specific service
docker compose up -d postgres

# Start with logs in foreground
docker compose up
```

### Stop Services

```bash
# Stop all services (keeps volumes)
docker compose down

# Stop and remove volumes (⚠️ DATA LOSS!)
docker compose down -v
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f postgres

# Last 100 lines
docker compose logs --tail=100
```

### Check Health Status

```bash
# List all services with status
docker compose ps

# Check specific service
docker compose ps postgres
```

### Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart redis
```

### Reset Everything

```bash
# Stop, remove containers and volumes, restart fresh
docker compose down -v
docker compose up -d
```

## Data Persistence

All service data is stored in named Docker volumes:

- `quorum-postgres-data`: PostgreSQL database files
- `quorum-redis-data`: Redis persistence files
- `quorum-minio-data`: MinIO object storage files
- `quorum-minio-config`: MinIO configuration

**View volumes**:

```bash
docker volume ls | grep quorum
```

**Backup a volume**:

```bash
# Example: Backup PostgreSQL data
docker compose stop postgres
docker run --rm -v quorum-postgres-data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .
docker compose start postgres
```

**Restore a volume**:

```bash
# Example: Restore PostgreSQL data
docker compose stop postgres
docker run --rm -v quorum-postgres-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/postgres-backup.tar.gz"
docker compose start postgres
```

## Troubleshooting

### Service won't start

1. Check if ports are already in use:

   ```bash
   lsof -i :5432  # PostgreSQL
   lsof -i :6379  # Redis
   lsof -i :9000  # MinIO API
   lsof -i :9001  # MinIO Console
   ```

2. View service logs:

   ```bash
   docker compose logs [service-name]
   ```

3. Restart the service:
   ```bash
   docker compose restart [service-name]
   ```

### Health check failing

Wait 30 seconds for services to initialize, then check:

```bash
docker compose ps
```

If still unhealthy, check logs:

```bash
docker compose logs [service-name]
```

### Cannot connect to database

1. Verify PostgreSQL is healthy:

   ```bash
   docker compose ps postgres
   ```

2. Test connection from container:

   ```bash
   docker compose exec postgres pg_isready -U quorum
   ```

3. Check if using correct connection string:
   - From host: `localhost:5432`
   - From Docker: `postgres:5432`

### MinIO buckets not created

1. Check minio-init logs:

   ```bash
   docker compose logs minio-init
   ```

2. Manually create buckets:
   ```bash
   docker compose exec minio mc mb /data/recordings-raw
   docker compose exec minio mc mb /data/recordings-encoded
   docker compose exec minio mc mb /data/recordings-har
   ```

### Out of disk space

1. Remove unused Docker resources:

   ```bash
   docker system prune -a
   ```

2. Remove old volumes:
   ```bash
   docker volume prune
   ```

## Development Workflow

### With Prisma ORM

```bash
# Generate Prisma client
bunx prisma generate

# Run migrations
bunx prisma migrate dev

# Open Prisma Studio
bunx prisma studio
```

### Running the Application

```bash
# Start infrastructure
docker compose up -d

# Run application with hot reload
bun --hot index.ts

# Or if using the Dockerfile
docker compose up -d
```

### Running Tests

```bash
# Start test database
docker compose up -d postgres redis

# Run tests
bun test
```

## Production Considerations

This Docker setup is **for development only**. Before deploying to production:

1. **Change all default credentials**:
   - PostgreSQL password
   - Redis password (add AUTH)
   - MinIO access/secret keys

2. **Use secrets management**:
   - Docker secrets
   - Kubernetes secrets
   - AWS Secrets Manager
   - HashiCorp Vault

3. **Enable SSL/TLS**:
   - PostgreSQL SSL mode
   - Redis TLS
   - MinIO HTTPS

4. **Configure backups**:
   - Automated database backups
   - Point-in-time recovery
   - Off-site storage

5. **Implement monitoring**:
   - Health checks
   - Metrics collection
   - Log aggregation
   - Alerting

6. **Use managed services** (recommended):
   - AWS RDS for PostgreSQL
   - AWS ElastiCache for Redis
   - AWS S3 instead of MinIO

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)
- [MinIO Documentation](https://min.io/docs/)
