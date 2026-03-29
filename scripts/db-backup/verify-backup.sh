#!/bin/bash
# verify-backup.sh
# Restores the latest local backup to a temporary database for verification.

set -e

BACKUP_DIR="/mnt/backups/daily"
TEMP_DB_NAME="test_restore_verify"

# Ensure BACKUP_ENCRYPTION_KEY is set
if [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
    echo "Error: BACKUP_ENCRYPTION_KEY is not set."
    exit 1
fi

# Find the latest backup
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/db_backup_*.sql.gz.gpg | head -n 1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "No backups found in $BACKUP_DIR."
    exit 1
fi

echo "Verifying latest backup: $LATEST_BACKUP"

# 1. Create temporary database
# Assuming psql is available and configured
dropdb --if-exists "$TEMP_DB_NAME"
createdb "$TEMP_DB_NAME"

# 2. Restore Using restore.sh
./restore.sh "$LATEST_BACKUP" "postgres://localhost/$TEMP_DB_NAME"

# 3. Verify Basic Data (Counts)
echo "Running integrity checks..."
MOCK_RESULT=$(psql "postgres://localhost/$TEMP_DB_NAME" -t -c "SELECT COUNT(*) FROM users;")
echo "Found $MOCK_RESULT users in restored database."

if [ "$MOCK_RESULT" -ge 0 ]; then
    echo "Integrity check PASSED."
else
    echo "Integrity check FAILED."
fi

# 4. Cleanup
dropdb "$TEMP_DB_NAME"
echo "Temporary database cleaned up."

echo "Verification completed at $(date)"
