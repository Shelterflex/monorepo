import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

const DB_CONNECT_RETRIES = parseInt(process.env.DB_CONNECT_RETRIES ?? '5', 10)
const DB_CONNECT_RETRY_MS = parseInt(process.env.DB_CONNECT_RETRY_MS ?? '2000', 10)

async function connectWithRetry(databaseUrl: string): Promise<Pool> {
  for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt++) {
    try {
      const pool = new Pool({ connectionString: databaseUrl })
      await pool.query('SELECT 1')
      if (attempt > 1) {
        console.log(`[migrations] Connected on attempt ${attempt}`)
      }
      return pool
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[migrations] Connection attempt ${attempt}/${DB_CONNECT_RETRIES} failed: ${message}`,
      )

      if (attempt >= DB_CONNECT_RETRIES) {
        throw new Error(
          `Failed to connect to database after ${DB_CONNECT_RETRIES} attempts`,
        )
      }

      const delay = DB_CONNECT_RETRY_MS * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Exhausted retries')
}

export async function runMigrationsIfNeeded() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return

  const pool = await connectWithRetry(databaseUrl)

  const migrationsDir = path.resolve(process.cwd(), 'migrations')

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b))

    for (const file of files) {
      const alreadyApplied = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file],
      )

      if (alreadyApplied.rowCount) continue

      const sql = await readFile(path.join(migrationsDir, file), 'utf8')

      await pool.query('BEGIN')
      try {
        await pool.query(sql)
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await pool.query('COMMIT')
        console.log(`[migrations] Applied: ${file}`)
      } catch (error) {
        await pool.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await pool.end()
  }
}
