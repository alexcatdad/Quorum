# Backup and Restore Procedures

## Overview

This document outlines the procedures for backing up and restoring the Quorum system data.

## Components to Backup

1. **PostgreSQL Database** - All application data (organizations, users, meetings, recordings metadata)
2. **MinIO Object Storage** - All recording files (raw, encoded, HAR files)
3. **Redis** - Job queue state (optional, can be regenerated)

## Backup Procedures

### 1. PostgreSQL Database Backup

#### Daily Automated Backup

```bash
# Create backup
pg_dump -h localhost -U quorum -d quorum -F c -f backup_$(date +%Y%m%d_%H%M%S).dump

# With compression
pg_dump -h localhost -U quorum -d quorum -F c -Z 9 -f backup_$(date +%Y%m%d_%H%M%S).dump.gz
```

#### Kubernetes CronJob for Automated Backups

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:16
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: quorum-secrets
                  key: postgres-password
            command:
            - /bin/sh
            - -c
            - |
              pg_dump -h postgres -U quorum -d quorum -F c | \
              gzip > /backups/backup_$(date +%Y%m%d_%H%M%S).dump.gz
            volumeMounts:
            - name: backups
              mountPath: /backups
          volumes:
          - name: backups
            persistentVolumeClaim:
              claimName: backup-pvc
          restartPolicy: OnFailure
```

### 2. MinIO Backup

#### Using MinIO Client (mc)

```bash
# Install mc
wget https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc

# Configure
mc alias set minio http://localhost:9100 minioadmin minioadmin

# Mirror bucket to backup location
mc mirror minio/quorum-recordings /backups/minio/quorum-recordings

# Sync to S3 (recommended for production)
mc mirror minio/quorum-recordings s3/quorum-backups/recordings
```

#### Automated MinIO Backup Script

```bash
#!/bin/bash
# backup-minio.sh

BACKUP_DIR="/backups/minio"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p ${BACKUP_DIR}/${TIMESTAMP}

# Mirror all buckets
mc mirror minio/quorum-recordings ${BACKUP_DIR}/${TIMESTAMP}/recordings

# Compress
tar -czf ${BACKUP_DIR}/minio_backup_${TIMESTAMP}.tar.gz ${BACKUP_DIR}/${TIMESTAMP}

# Remove uncompressed backup
rm -rf ${BACKUP_DIR}/${TIMESTAMP}

# Keep only last 7 days
find ${BACKUP_DIR} -name "minio_backup_*.tar.gz" -mtime +7 -delete
```

### 3. Complete System Backup

```bash
#!/bin/bash
# full-backup.sh

BACKUP_ROOT="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

mkdir -p ${BACKUP_DIR}

echo "Starting full backup at ${TIMESTAMP}..."

# Backup PostgreSQL
echo "Backing up PostgreSQL..."
pg_dump -h localhost -U quorum -d quorum -F c -Z 9 -f ${BACKUP_DIR}/database.dump.gz

# Backup MinIO
echo "Backing up MinIO..."
mc mirror minio/quorum-recordings ${BACKUP_DIR}/recordings

# Create manifest
cat > ${BACKUP_DIR}/manifest.json <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "components": {
    "database": "database.dump.gz",
    "recordings": "recordings/"
  },
  "version": "1.0.0"
}
EOF

echo "Backup completed successfully!"
echo "Backup location: ${BACKUP_DIR}"
```

## Restore Procedures

### 1. PostgreSQL Database Restore

```bash
# Stop API and workers first
kubectl scale deployment quorum-api --replicas=0
kubectl scale deployment quorum-worker --replicas=0

# Restore database
pg_restore -h localhost -U quorum -d quorum -c -F c backup_20250116_020000.dump

# Or with gzip
gunzip -c backup_20250116_020000.dump.gz | pg_restore -h localhost -U quorum -d quorum -c

# Restart services
kubectl scale deployment quorum-api --replicas=3
kubectl scale deployment quorum-worker --replicas=2
```

### 2. MinIO Restore

```bash
# Restore from backup
mc mirror /backups/minio/20250116_020000/recordings minio/quorum-recordings

# Or from S3
mc mirror s3/quorum-backups/recordings minio/quorum-recordings
```

### 3. Complete System Restore

```bash
#!/bin/bash
# full-restore.sh

BACKUP_DIR=$1

if [ -z "$BACKUP_DIR" ]; then
  echo "Usage: $0 <backup_directory>"
  exit 1
fi

echo "Restoring from backup: ${BACKUP_DIR}"

# Stop services
echo "Stopping services..."
kubectl scale deployment quorum-api --replicas=0
kubectl scale deployment quorum-worker --replicas=0

# Wait for pods to terminate
sleep 10

# Restore database
echo "Restoring database..."
gunzip -c ${BACKUP_DIR}/database.dump.gz | pg_restore -h localhost -U quorum -d quorum -c

# Restore MinIO
echo "Restoring recordings..."
mc mirror ${BACKUP_DIR}/recordings minio/quorum-recordings

# Restart services
echo "Restarting services..."
kubectl scale deployment quorum-api --replicas=3
kubectl scale deployment quorum-worker --replicas=2

echo "Restore completed successfully!"
```

## Disaster Recovery

### Recovery Time Objective (RTO)

- **Target RTO**: 1 hour
- **Maximum RTO**: 4 hours

### Recovery Point Objective (RPO)

- **Database**: 24 hours (daily backups)
- **Recordings**: 24 hours (daily backups)

### Disaster Recovery Steps

1. **Assessment** (5 minutes)
   - Identify the scope of the disaster
   - Determine which components are affected

2. **Infrastructure Provisioning** (15-30 minutes)
   - Provision new Kubernetes cluster if needed
   - Set up PostgreSQL, Redis, and MinIO

3. **Data Restoration** (30-60 minutes)
   - Restore latest database backup
   - Restore recordings from backup

4. **Service Verification** (15 minutes)
   - Run health checks
   - Verify API endpoints
   - Test recording functionality

5. **DNS Update** (5-10 minutes)
   - Update DNS to point to new infrastructure
   - Monitor traffic

### Disaster Recovery Testing

**Quarterly DR Drills** - Perform a full disaster recovery test every quarter to ensure:
- Backups are valid and complete
- Restore procedures work correctly
- RTO/RPO targets are met
- Team is familiar with procedures

## Backup Retention Policy

- **Daily backups**: Keep for 30 days
- **Weekly backups** (Sunday): Keep for 12 weeks
- **Monthly backups** (1st of month): Keep for 12 months
- **Yearly backups** (January 1st): Keep for 7 years (compliance)

## Security

- All backups must be encrypted at rest
- Backups should be stored in a different region/availability zone
- Access to backups should be restricted to authorized personnel only
- Regular backup integrity checks should be performed

## Monitoring

Set up alerts for:
- Backup job failures
- Backup size anomalies
- Backup age exceeding thresholds
- Storage capacity for backups

## Contact Information

- **Primary Contact**: DevOps Team - devops@example.com
- **Secondary Contact**: Infrastructure Team - infrastructure@example.com
- **Emergency Escalation**: CTO - cto@example.com
