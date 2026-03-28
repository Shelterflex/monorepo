import { describe, it, expect, beforeEach } from 'vitest'
import { setPool, getPoolMetrics, type PgPoolLike } from './db.js'

describe('db pool metrics', () => {
  beforeEach(() => {
    setPool(null)
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
})
