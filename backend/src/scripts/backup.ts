import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import "dotenv/config";

const execAsync = promisify(exec);

const DB_URL = process.env.DATABASE_URL;
const BACKUP_DIR = path.join(process.cwd(), 'backups');
const RETENTION_DAYS = 7;

export async function runBackup() {
  if (!DB_URL) {
    console.warn("[Backup] DATABASE_URL is not set. Skipping backup.");
    return;
  }
  
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  console.log(`[Backup] Starting database backup to ${filepath}...`);

  try {
    await execAsync(`pg_dump "${DB_URL}" -f "${filepath}"`);
    console.log(`[Backup] Completed successfully: ${filename}`);

    cleanOldBackups();
  } catch (error) {
    console.error("[Backup] Failed:", error);
    process.exitCode = 1;
  }
}

function cleanOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  files.forEach((file) => {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > maxAgeMs) {
      console.log(`[Backup] Deleting old backup: ${file}`);
      fs.unlinkSync(filePath);
    }
  });
}

// Run if called directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  runBackup();
}
