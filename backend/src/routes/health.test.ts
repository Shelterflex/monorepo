import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestAgent } from '../test-helpers.js'
import * as db from '../db.js'

// Mock the db module
vi.mock('../db.js', () => ({
  getPool: vi.fn(),
}))

describe('Health Routes', () => {
  const request = createTestAgent()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'postgres://user:password@localhost:5432/db')
  })

  describe('GET /health/details', () => {
    it('returns operational metadata when DB is connected', async () => {
      // Mock successful DB connection
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '1': 1 }] }),
      };
      (db.getPool as any).mockResolvedValue(mockPool)

      const res = await request.get('/health/details')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('version')
      expect(res.body).toHaveProperty('nodeEnv')
      expect(res.body).toHaveProperty('uptimeSeconds')
      expect(res.body).toHaveProperty('requestId')
      expect(res.body).toHaveProperty('sorobanAdapterMode')
      expect(res.body).toHaveProperty('databaseEnabled', true)

      // Absence check for forbidden fields
      expect(res.body).not.toHaveProperty('process.env')
      expect(res.body).not.toHaveProperty('DATABASE_URL')
      expect(res.body).not.toHaveProperty('env')
      
      // Specifically ensure we don't leak the mocked DATABASE_URL or password
      const bodyString = JSON.stringify(res.body)
      expect(bodyString).not.toContain('postgres://')
      expect(bodyString).not.toContain('password')
    })

    it('returns dbConnected: false when DB connection fails', async () => {
      // Mock failed DB connection
      (db.getPool as any).mockResolvedValue(null)

      const res = await request.get('/health/details')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('databaseEnabled', false)
    })

    it('returns dbConnected: false when pool.query fails', async () => {
      // Mock successful pool retrieval but failed query
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };
      (db.getPool as any).mockResolvedValue(mockPool)

      const res = await request.get('/health/details')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('databaseEnabled', false)
    })
  })
})
