import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setPool, setReadPool, getPool, getReadPool, getPoolMetrics, type PgPoolLike } from './db.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMockPool(queryResult: any = { rows: [], rowCount: 0 }): PgPoolLike & Record<string, any> {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
  } as any
}

// ── existing pool metrics tests ───────────────────────────────────────────────

describe('db pool metrics', () => {
  beforeEach(() => {
    setPool(null)
    setReadPool(null)
    delete process.env.READ_REPLICA_URL
  })

  afterEach(() => {
    setPool(null)
    setReadPool(null)
  })

  it('returns null when no pool is set', () => {
    expect(getPoolMetrics()).toBeNull()
  })

  it('returns metrics when pool is set', () => {
    const mockPool = {
      totalCount: 10,
      idleCount: 6,
      waitingCount: 2,
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => {},
      }),
    } as unknown as PgPoolLike

    setPool(mockPool)
    const metrics = getPoolMetrics()

    expect(metrics).not.toBeNull()
    expect(metrics!.totalCount).toBe(10)
    expect(metrics!.idleCount).toBe(6)
    expect(metrics!.waitingCount).toBe(2)
    expect(metrics!.activeCount).toBe(4)
    expect(typeof metrics!.slowQueryCount).toBe('number')
  })

  it('handles pool without count properties gracefully', () => {
    const mockPool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => {},
      }),
    } as unknown as PgPoolLike

    setPool(mockPool)
    const metrics = getPoolMetrics()

    expect(metrics).not.toBeNull()
    expect(metrics!.totalCount).toBe(0)
    expect(metrics!.idleCount).toBe(0)
    expect(metrics!.activeCount).toBe(0)
  })

  it('includes circuitBreaker state in metrics', () => {
    const mockPool = makeMockPool()
    setPool(mockPool)

    const metrics = getPoolMetrics()
    expect(metrics!.circuitBreaker.primary).toBe('closed')
    expect(metrics!.circuitBreaker.replica).toBe('none')
    expect(metrics!.replicaEnabled).toBe(false)
  })

  it('reports replicaEnabled and replica circuit state when readPool is set', () => {
    const primary = makeMockPool()
    setPool(primary)
    const replica = makeMockPool()
    setReadPool(replica)

    const metrics = getPoolMetrics()
    expect(metrics!.replicaEnabled).toBe(true)
    expect(metrics!.circuitBreaker.replica).toBe('closed')
  })
})

// ── getPool() ─────────────────────────────────────────────────────────────────

describe('getPool()', () => {
  beforeEach(() => {
    setPool(null)
    setReadPool(null)
    delete process.env.DATABASE_URL
  })

  afterEach(() => {
    setPool(null)
    vi.restoreAllMocks()
  })

  it('returns null when DATABASE_URL is not set', async () => {
    expect(await getPool()).toBeNull()
  })

  it('returns the injected pool immediately without hitting pg', async () => {
    const mock = makeMockPool()
    setPool(mock)
    expect(await getPool()).toBe(mock)
  })
})

// ── getReadPool() ─────────────────────────────────────────────────────────────

describe('getReadPool()', () => {
  beforeEach(() => {
    setPool(null)
    setReadPool(null)
    delete process.env.DATABASE_URL
    delete process.env.READ_REPLICA_URL
  })

  afterEach(() => {
    setPool(null)
    setReadPool(null)
    vi.restoreAllMocks()
  })

  it('falls back to primary when READ_REPLICA_URL is not set', async () => {
    const primary = makeMockPool()
    setPool(primary)
    const result = await getReadPool()
    expect(result).toBe(primary)
  })

  it('uses the injected read pool when READ_REPLICA_URL is set', async () => {
    process.env.READ_REPLICA_URL = 'postgres://replica/db'
    const replica = makeMockPool({ rows: [{ val: 1 }], rowCount: 1 })
    setReadPool(replica)

    const result = await getReadPool()
    expect(result).not.toBeNull()

    const rows = await result!.query('SELECT 1')
    expect(rows.rows).toEqual([{ val: 1 }])
    expect((replica.query as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('SELECT 1', undefined)
  })

  it('propagates errors from the replica pool query', async () => {
    process.env.READ_REPLICA_URL = 'postgres://replica/db'
    const replica: PgPoolLike = {
      query: vi.fn().mockRejectedValue(new Error('replica unavailable')),
      connect: vi.fn(),
    }
    setReadPool(replica)

    const result = await getReadPool()
    await expect(result!.query('SELECT 1')).rejects.toThrow('replica unavailable')
  })
})
