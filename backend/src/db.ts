export type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  release: () => void
}

export type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  connect: () => Promise<PgClientLike>
}

let pool: PgPoolLike | null = null
let readPool: PgPoolLike | null = null

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

// Circuit breaker settings
const CB_FAILURE_THRESHOLD = parseInt(process.env.DB_CB_FAILURE_THRESHOLD ?? '5', 10)
const CB_RECOVERY_MS = parseInt(process.env.DB_CB_RECOVERY_MS ?? '30000', 10)

// ── Circuit Breaker ───────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreaker {
  state: CircuitState
  failures: number
  openedAt: number | null
}

const primaryCircuit: CircuitBreaker = { state: 'closed', failures: 0, openedAt: null }
const replicaCircuit: CircuitBreaker = { state: 'closed', failures: 0, openedAt: null }

function recordSuccess(cb: CircuitBreaker): void {
  cb.failures = 0
  cb.state = 'closed'
  cb.openedAt = null
}

function recordFailure(cb: CircuitBreaker): void {
  cb.failures++
  if (cb.failures >= CB_FAILURE_THRESHOLD) {
    cb.state = 'open'
    cb.openedAt = Date.now()
    console.error(JSON.stringify({ level: 'error', message: 'DB circuit breaker OPEN', failures: cb.failures, timestamp: new Date().toISOString() }))
  }
}

function isAvailable(cb: CircuitBreaker): boolean {
  if (cb.state === 'closed') return true
  if (cb.state === 'open' && cb.openedAt !== null && Date.now() - cb.openedAt >= CB_RECOVERY_MS) {
    cb.state = 'half-open'
    console.log(JSON.stringify({ level: 'info', message: 'DB circuit breaker HALF-OPEN (probing)', timestamp: new Date().toISOString() }))
    return true
  }
  return cb.state === 'half-open'
}

// ── Pool metrics ──────────────────────────────────────────────────────────────

export interface PoolMetrics {
  totalCount: number
  idleCount: number
  waitingCount: number
  activeCount: number
  slowQueryCount: number
  circuitBreaker: {
    primary: CircuitState
    replica: CircuitState | 'none'
  }
  replicaEnabled: boolean
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
    circuitBreaker: {
      primary: primaryCircuit.state,
      replica: readPool ? replicaCircuit.state : 'none',
    },
    replicaEnabled: !!readPool,
  }
}

export function setPool(newPool: PgPoolLike | null) {
  pool = newPool
}

export function setReadPool(newPool: PgPoolLike | null) {
  readPool = newPool
}

/**
 * Returns a pool for read queries. Prefers the read replica when available and
 * its circuit breaker is closed/half-open; falls back to the primary pool.
 */
export async function getReadPool(): Promise<PgPoolLike | null> {
  const replicaUrl = process.env.READ_REPLICA_URL

  if (replicaUrl && isAvailable(replicaCircuit)) {
    if (!readPool) {
      for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt++) {
        try {
          const mod = await import('pg')
          const PgPool = (mod as any).Pool
          const candidate = new PgPool({
            connectionString: replicaUrl,
            max: DB_POOL_MAX,
            min: DB_POOL_MIN,
            idleTimeoutMillis: DB_POOL_IDLE_TIMEOUT_MS,
            connectionTimeoutMillis: DB_POOL_CONNECTION_TIMEOUT_MS,
            statement_timeout: DB_STATEMENT_TIMEOUT_MS,
          })

          await candidate.query('SELECT 1')

          candidate.on('error', (err: Error) => {
            console.error(
              JSON.stringify({
                level: 'error',
                message: 'Unexpected replica pool client error',
                errorMessage: err.message,
                timestamp: new Date().toISOString(),
              }),
            )
          })

          readPool = wrapPoolWithQueryLogging(candidate)

          console.log(
            JSON.stringify({
              level: 'info',
              message: 'Read replica pool initialized',
              ...(attempt > 1 ? { connectedOnAttempt: attempt } : {}),
            }),
          )
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[db] Replica connection attempt ${attempt}/${DB_CONNECT_RETRIES} failed: ${message}`)
          recordFailure(replicaCircuit)

          if (attempt < DB_CONNECT_RETRIES) {
            const delay = DB_CONNECT_RETRY_MS * Math.pow(2, attempt - 1)
            await new Promise((resolve) => setTimeout(resolve, delay))
          }
        }
      }
    }

    if (readPool) {
      // Wrap the replica pool query to track circuit breaker state
      const originalQuery = readPool.query.bind(readPool)
      return {
        query: async (text: string, params?: unknown[]) => {
          try {
            const result = await originalQuery(text, params)
            recordSuccess(replicaCircuit)
            return result
          } catch (err) {
            recordFailure(replicaCircuit)
            throw err
          }
        },
        connect: readPool.connect.bind(readPool),
      }
    }
  }

  // Fall back to primary
  return getPool()
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

  if (!isAvailable(primaryCircuit)) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'DB primary circuit breaker is OPEN — refusing connection',
        timestamp: new Date().toISOString(),
      }),
    )
    return null
  }

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
      recordSuccess(primaryCircuit)

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
      recordFailure(primaryCircuit)

      if (attempt < DB_CONNECT_RETRIES) {
        const delay = DB_CONNECT_RETRY_MS * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  console.error(`[db] All ${DB_CONNECT_RETRIES} connection attempts failed`)
  return null
}
