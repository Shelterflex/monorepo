# Point-In-Time Recovery (PITR) Setup

To enable Point-In-Time Recovery in PostgreSQL, follow these configuration steps in your `postgresql.conf` and `pg_hba.conf`.

## 1. PostgreSQL Configuration (`postgresql.conf`)

Enable WAL archiving to capture data changes between daily backups:

```conf
# Settings for Continuous Archiving
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /mnt/server/archivedir/%f && cp %p /mnt/server/archivedir/%f'
archive_timeout = 60 # Force a WAL switch every 60 seconds (reduces RPO to 1 minute)
```

## 2. Directory Structure

Ensure the archive directory exists and is writable by the `postgres` user:

```bash
mkdir -p /mnt/server/archivedir
chown postgres:postgres /mnt/server/archivedir
```

## 3. Base Backups

While `pg_dump` provides logical backups, PITR requires physical base backups once a week:

```bash
pg_basebackup -h localhost -D /mnt/backups/base -Ft -z -P
```

## 4. Recovery Point Objective (RPO)
With `archive_timeout = 60`, your RPO is effectively **1 minute**, meaning you could lose at most 1 minute of data in a disaster.
