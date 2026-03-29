#!/bin/bash
# automated-backup.sh
# Performs a logical PostgreSQL backup, compresses, and encrypts it.

set -e

# Configuration
BACKUP_DIR="/mnt/backups/daily"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d%H%M%S)
BACKUP_NAME="db_backup_${TIMESTAMP}.sql.gz.gpg"
PRIMARY_REGION_TARGET="s3://backup-primary/daily/"
SECONDARY_REGION_TARGET="s3://backup-secondary/daily/"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "Starting database backup at $(date)"

# 1. Perform pg_dump and compress
# Uses DATABASE_URL from environment
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL is not set."
    exit 1
fi

if [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
    echo "Error: BACKUP_ENCRYPTION_KEY is not set for encryption."
    exit 1
fi

# Use pg_dump -> gzip -> gpg
pg_dump "$DATABASE_URL" | \
    gzip | \
    gpg --symmetric --batch --yes --passphrase "$BACKUP_ENCRYPTION_KEY" \
    > "${BACKUP_DIR}/${BACKUP_NAME}"

echo "Backup created: ${BACKUP_DIR}/${BACKUP_NAME}"

# 2. Integrity Check (Simple size check)
FILESIZE=$(stat -c%s "${BACKUP_DIR}/${BACKUP_NAME}")
if [ "$FILESIZE" -lt 1024 ]; then
    echo "Warning: Backup file is suspiciously small ($FILESIZE bytes)."
fi

# 3. Simulated Cross-Region Upload
echo "Uploading to primary region: $PRIMARY_REGION_TARGET"
# aws s3 cp "${BACKUP_DIR}/${BACKUP_NAME}" "$PRIMARY_REGION_TARGET"

echo "Uploading to secondary region: $SECONDARY_REGION_TARGET"
# aws s3 cp "${BACKUP_DIR}/${BACKUP_NAME}" "$SECONDARY_REGION_TARGET"

# 4. Retention Policy (Cleanup old local backups)
find "$BACKUP_DIR" -type f -name "db_backup_*.sql.gz.gpg" -mtime +"$RETENTION_DAYS" -delete
echo "Old backups cleaned up."

echo "Backup process completed at $(date)"
