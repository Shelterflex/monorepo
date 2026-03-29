# Disaster Recovery Runbook - PostgreSQL

This document outlines the procedures for recovering the PostgreSQL database in various disaster scenarios.

## Recovery Targets

| Metric | Target | Description |
|--------|--------|-------------|
| **RPO** (Recovery Point Objective) | **5 Minutes** | Max data loss acceptable via WAL archiving. |
| **RTO** (Recovery Time Objective) | **4 Hours** | Max time to restore service after failure. |

## Scenario 1: Accidental Data Deletion (PITR)

**Symptoms**: User deleted a critical table or record 15 minutes ago.

**Procedure**:
1. Identify the timestamp for recovery (e.g., 2026-03-28 12:30:00).
2. Stop the application to prevent further inconsistencies.
3. Use the latest Daily Backup as a base.
4. Prepare the `postgresql.conf` for recovery:
   ```bash
   restore_command = 'cp /mnt/server/archivedir/%f %p'
   recovery_target_time = '2026-03-28 12:30:00 MSK'
   ```
5. Start PostgreSQL. It will replay WAL segments until the target time.
6. Verify data integrity and resume service.

## Scenario 2: Main Database Outage (Full Restore)

**Symptoms**: Production database server is unreachable or corrupt.

**Procedure**:
1. Provision a new PostgreSQL instance.
2. Download the latest encrypted backup from the **Primary Region** (S3).
3. Set `BACKUP_ENCRYPTION_KEY` in the environment.
4. Run the restoration script:
   ```bash
   ./scripts/db-backup/restore.sh latest_backup.sql.gz.gpg "$DATABASE_URL"
   ```
5. Apply any missed WAL segments from the archive directory.
6. Run `verify-backup.sh` to confirm data presence.

## Scenario 3: Regional Failure (Cross-Region)

**Symptoms**: Primary cloud region is entirely down.

**Procedure**:
1. Switch infrastructure orchestrator (e.g., Terraform/Kubernetes) to the **Secondary Region**.
2. Download backups from the **Secondary Storage Bucket**.
3. Follow the Full Restore procedure in the new region.
4. Update DNS/Load Balancer to point to the new region endpoints.

## Maintenance and Drills

- **Weekly**: Run `verify-backup.sh` to ensure backups are readable.
- **Bi-Annually**: Perform a full DR drill including region failover.
