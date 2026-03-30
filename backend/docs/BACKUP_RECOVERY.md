# Backend Database Backup & Recovery

## Overview
Automated, node-native procedures to seamlessly back up the Postgres DB daily and restore it from any previous checkpoint locally using `pg_dump` and `psql`.

## Retention Policy
Automated backups run every 24 hours. The retention policy stores files for a maximum of 7 days in the `backend/backups/` directory before being permanently purged.

## Taking a Manual Backup
To instantly capture a snapshot of the database via the configured `DATABASE_URL`:
```bash
npm run db:backup
```
*Outputs an SQL dump into `backups/backup-<TIMESTAMP>.sql`.*

## Testing/Performing a Restore
**Warning:** Be careful not to run restores to production instances unprepared as old data will overwrite the current live subset depending on the dump content.

Provide the exact path to the backup generated:
```bash
npm run db:restore backups/backup-xyz.sql
```

## Troubleshooting
If you experience `command not found: pg_dump` or `command not found: psql`, make sure you have the standard Postgres client utilities installed directly on the execution environment.
