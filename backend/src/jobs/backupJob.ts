import { runBackup } from '../scripts/backup.js';

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startBackupJob() {
  if (!process.env.DATABASE_URL) {
    console.log("[backupJob] No DATABASE_URL set. Skipping automated backups.");
    return;
  }

  console.log(`[backupJob] Scheduling automated database backups every ${BACKUP_INTERVAL_MS / 1000 / 60 / 60} hours.`);
  
  setInterval(() => {
    runBackup().catch((err: unknown) => {
      console.error("[backupJob] Automated backup failed:", err);
    });
  }, BACKUP_INTERVAL_MS);
}
