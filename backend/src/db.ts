export type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  release: () => void
}

export type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  connect: () => Promise<PgClientLike>
}

let pool: PgPoolLike | null = null

// Connection retry settings
const DB_CONNECT_RETRIES = parseInt(process.env.DB_CONNECT_RETRIES ?? '5', 10)
const DB_CONNECT_RETRY_MS = parseInt(process.env.DB_CONNECT_RETRY_MS ?? '2000', 10)

// Configurable pool settings
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX ?? '20', 10)
const DB_POOL_MIN = parseInt(process.env.DB_POOL_MIN ?? '2', 10)
const DB_POOL_IDLE_TIMEOUT_MS = parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10)
const DB_POOL_CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '5000', 10)
const DB_STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '30000', 10)
const DB_SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.DB_SLOW_QUERY_THRESHOLD_MS ?? '200', 10)

// Pool metrics
export interface PoolMetrics {
  totalCount: number
  idleCount: number
  waitingCount: number
  activeCount: number
  slowQueryCount: number
}

let slowQueryCount = 0

export function getPoolMetrics(): PoolMetrics | null {
  if (!pool) return null
  const p = pool as any
  return {
    totalCount: typeof p.totalCount === 'number' ? p.totalCount : 0,
    idleCount: typeof p.idleCount === 'number' ? p.idleCount : 0,
    waitingCount: typeof p.waitingCount === 'number' ? p.waitingCount : 0,
    activeCount:
      typeof p.totalCount === 'number' && typeof p.idleCount === 'number'
        ? p.totalCount - p.idleCount
        : 0,
    slowQueryCount,
  }
}

export function setPool(newPool: PgPoolLike | null) {
  pool = newPool
}

/**
 * Wraps a pool to add slow-query logging on every query call.
 */
function wrapPoolWithQueryLogging(candidate: any): PgPoolLike {
  const originalQuery = candidate.query.bind(candidate)
  candidate.query = async (text: string, params?: unknown[]) => {
    const start = Date.now()
    try {
      const result = await originalQuery(text, params)
      const durationMs = Date.now() - start
      if (durationMs >= DB_SLOW_QUERY_THRESHOLD_MS) {
        slowQueryCount++
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'Slow query detected',
            durationMs,
            query: text.slice(0, 200),
            threshold: DB_SLOW_QUERY_THRESHOLD_MS,
            timestamp: new Date().toISOString(),
          }),
        )
      }
      return result
    } catch (err) {
      const durationMs = Date.now() - start
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Query failed',
          durationMs,
          query: text.slice(0, 200),
          errorMessage: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      )
      throw err
    }
  }
  return candidate as PgPoolLike
}

export async function getPool(): Promise<PgPoolLike | null> {
  if (pool) return pool
  if (!process.env.DATABASE_URL) return null

  for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt++) {
    try {
      const mod = await import('pg')
      const PgPool = (mod as any).Pool
      const candidate = new PgPool({
        connectionString: process.env.DATABASE_URL,
        max: DB_POOL_MAX,
        min: DB_POOL_MIN,
        idleTimeoutMillis: DB_POOL_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: DB_POOL_CONNECTION_TIMEOUT_MS,
        statement_timeout: DB_STATEMENT_TIMEOUT_MS,
      })

      // Verify the connection is actually usable
      await candidate.query('SELECT 1')

      // Log pool error events to prevent silent failures
      candidate.on('error', (err: Error) => {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Unexpected pool client error',
            errorMessage: err.message,
            timestamp: new Date().toISOString(),
          }),
        )
      })

      pool = wrapPoolWithQueryLogging(candidate)

      console.log(
        JSON.stringify({
          level: 'info',
          message: 'Database pool initialized',
          poolMax: DB_POOL_MAX,
          poolMin: DB_POOL_MIN,
          idleTimeoutMs: DB_POOL_IDLE_TIMEOUT_MS,
          connectionTimeoutMs: DB_POOL_CONNECTION_TIMEOUT_MS,
          statementTimeoutMs: DB_STATEMENT_TIMEOUT_MS,
          slowQueryThresholdMs: DB_SLOW_QUERY_THRESHOLD_MS,
          ...(attempt > 1 ? { connectedOnAttempt: attempt } : {}),
        }),
      )

      return pool
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[db] Connection attempt ${attempt}/${DB_CONNECT_RETRIES} failed: ${message}`,
      )

      if (attempt < DB_CONNECT_RETRIES) {
        const delay = DB_CONNECT_RETRY_MS * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  console.error(`[db] All ${DB_CONNECT_RETRIES} connection attempts failed`)
  return null
}
