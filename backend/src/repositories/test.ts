import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run this script.");
}

const databaseUrlStr = databaseUrl;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

async function runMigrations(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [file],
    );

    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file],
      );
      await pool.query("COMMIT");
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

async function assertRequiredIndexes(pool: any): Promise<void> {
  const { rows } = await pool.query(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('deals', 'listings', 'rewards', 'outbox_items')
    `,
  );

  const found = new Set(rows.map((row: { indexname: string }) => row.indexname));
  const required = [
    "deals_canonical_external_ref_v1_uidx",
    "listings_deal_id_idx",
    "listings_status_idx",
    "rewards_listing_id_idx",
    "rewards_status_idx",
    "outbox_status_idx",
    "outbox_next_retry_idx",
    "outbox_aggregate_idx",
  ];

  const missing = required.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required indexes: ${missing.join(", ")}`);
  }
}

async function runPersistenceChecks(pool: any): Promise<void> {
  const canonicalRef = `test-ref-${Date.now()}`;

  const dealResult = await pool.query(
    `
      INSERT INTO deals (canonical_external_ref_v1, status, payload)
      VALUES ($1, 'NEW', '{}'::jsonb)
      RETURNING id
    `,
    [canonicalRef],
  );

  const dealId = dealResult.rows[0]?.id;
  if (!dealId) {
    throw new Error("Failed to create a deal row.");
  }

  const listingResult = await pool.query(
    `
      INSERT INTO listings (deal_id, status, payload)
      VALUES ($1, 'ACTIVE', '{}'::jsonb)
      RETURNING id
    `,
    [dealId],
  );

  const listingId = listingResult.rows[0]?.id;
  if (!listingId) {
    throw new Error("Failed to create a listing row.");
  }

  await pool.query(
    `
      INSERT INTO rewards (listing_id, status, amount_cents)
      VALUES ($1, 'PENDING', 5000)
    `,
    [listingId],
  );

  const outboxResult = await pool.query(
    `
      INSERT INTO outbox_items (aggregate_type, aggregate_id, event_type, payload)
      VALUES ('deal', $1, 'deal.created', '{}'::jsonb)
      RETURNING id
    `,
    [dealId],
  );

  const outboxId = outboxResult.rows[0]?.id;
  if (!outboxId) {
    throw new Error("Failed to create an outbox row.");
  }

  await pool.query(
    `
      UPDATE outbox_items
      SET retry_count = retry_count + 1,
          next_retry_at = NOW() + INTERVAL '5 minutes'
      WHERE id = $1
    `,
    [outboxId],
  );

  const verificationPool = new (await import('pg')).Pool({ connectionString: databaseUrlStr });
  try {
    const persistedCheck = await verificationPool.query(
      "SELECT retry_count FROM outbox_items WHERE id = $1",
      [outboxId],
    );

    const retryCount = persistedCheck.rows[0]?.retry_count;
    if (retryCount !== 1) {
      throw new Error(`Expected retry_count=1, got ${String(retryCount)}`);
    }

    console.log("Persistence check passed:");
    console.log(`- deal persisted: ${dealId}`);
    console.log(`- listing persisted: ${listingId}`);
    console.log(`- outbox retry persisted: ${outboxId}`);
  } finally {
    await verificationPool.end();
  }
}

async function main() {
  const mod = await import('pg');
  const Pool = (mod as any).Pool as new (opts: { connectionString: string }) => any;
  const pool = new Pool({ connectionString: databaseUrlStr });

  try {
    console.log("Running migrations...");
    await runMigrations(pool);

    console.log("Validating required indexes...");
    await assertRequiredIndexes(pool);

    console.log("Running persistence and outbox retry checks...");
    await runPersistenceChecks(pool);

    console.log("DB setup and migration test completed successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("DB setup test failed:", error);
  process.exitCode = 1;
});