#!/bin/bash
# restore.sh
# Decrypts, decompresses, and restores a PostgreSQL backup.

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <backup_file> <target_db_url>"
    exit 1
fi

BACKUP_FILE=$1
TARGET_DB_URL=$2

if [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
    echo "Error: BACKUP_ENCRYPTION_KEY is not set."
    exit 1
fi

echo "Starting restoration from $BACKUP_FILE to $TARGET_DB_URL..."

# 1. Decrypt, Decompress and Restore
# gpg -> gunzip -> psql
gpg --decrypt --batch --passphrase "$BACKUP_ENCRYPTION_KEY" "$BACKUP_FILE" | \
    gunzip | \
    psql "$TARGET_DB_URL"

echo "Restoration completed successfully."
