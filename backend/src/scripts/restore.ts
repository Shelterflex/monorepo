import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import "dotenv/config";

const execAsync = promisify(exec);
const DB_URL = process.env.DATABASE_URL;

async function runRestore() {
  if (!DB_URL) {
    console.error("[Restore] DATABASE_URL is not set.");
    process.exit(1);
  }

  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error("[Restore] Please provide a backup file path. Example: npm run db:restore backups/backup-xyz.sql");
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), backupFile);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`[Restore] Backup file not found at: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`[Restore] Restoring database from ${resolvedPath}...`);

  try {
    await execAsync(`psql "${DB_URL}" -f "${resolvedPath}"`);
    console.log("[Restore] Database restore completed successfully.");
  } catch (error) {
    console.error("[Restore] Failed:", error);
    process.exit(1);
  }
}

runRestore();
