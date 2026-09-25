import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { gasAnalyzer } from '../soroban/gas-analyzer.js'
import { sessionStore, userStore } from '../models/authStore.js'

describe('Gas Metrics API', () => {
  let app: any
  let authToken: string

  beforeEach(async () => {
    app = createApp()
    gasAnalyzer.clearMetrics()
    await sessionStore.clear()
    await userStore.clear()

    // Create a test user and session for authenticated requests
    await userStore.getOrCreateByEmail('test@example.com')
    const session = await sessionStore.create('test@example.com', 'test-token')
    authToken = session.token
  })

  describe('GET /api/gas-metrics/benchmarks', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/benchmarks')
        .expect(401)

      expect(response.body.error).toBeDefined()
    })

    it('should return gas benchmarks with authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/benchmarks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body).toHaveProperty('benchmarks')
      expect(response.body).toHaveProperty('count')
      expect(Array.isArray(response.body.benchmarks)).toBe(true)
    })

    it('should return empty benchmarks when no data exists', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/benchmarks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.benchmarks).toHaveLength(0)
      expect(response.body.count).toBe(0)
    })

    it('should return benchmarks with correct structure when data exists', async () => {
      // Seed some test data
      gasAnalyzer.recordMetrics({
        functionName: 'test_function',
        cpuInstructions: 1000000,
        memoryBytes: 5000,
        ledgerReadBytes: 1000,
        ledgerWriteBytes: 500,
        totalFee: '100000',
        timestamp: Date.now(),
      })

      const response = await request(app)
        .get('/api/gas-metrics/benchmarks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.benchmarks.length).toBeGreaterThan(0)
      const benchmark = response.body.benchmarks[0]
      expect(benchmark).toHaveProperty('functionName')
      expect(benchmark).toHaveProperty('avgCpuInstructions')
      expect(benchmark).toHaveProperty('avgMemoryBytes')
      expect(benchmark).toHaveProperty('avgTotalFee')
      expect(benchmark).toHaveProperty('sampleCount')
      expect(benchmark).toHaveProperty('p50Fee')
      expect(benchmark).toHaveProperty('p95Fee')
      expect(benchmark).toHaveProperty('p99Fee')
    })
  })

  describe('GET /api/gas-metrics/recommendations', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/recommendations')
        .expect(401)

      expect(response.body.error).toBeDefined()
    })

    it('should return gas optimization recommendations with authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/recommendations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body).toHaveProperty('recommendations')
      expect(response.body).toHaveProperty('totalCount')
      expect(response.body.recommendations).toHaveProperty('critical')
      expect(response.body.recommendations).toHaveProperty('high')
      expect(response.body.recommendations).toHaveProperty('medium')
      expect(response.body.recommendations).toHaveProperty('low')
      expect(Array.isArray(response.body.recommendations.critical)).toBe(true)
      expect(Array.isArray(response.body.recommendations.high)).toBe(true)
      expect(Array.isArray(response.body.recommendations.medium)).toBe(true)
      expect(Array.isArray(response.body.recommendations.low)).toBe(true)
    })

    it('should return empty recommendations when no data exists', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/recommendations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.recommendations.critical).toHaveLength(0)
      expect(response.body.recommendations.high).toHaveLength(0)
      expect(response.body.recommendations.medium).toHaveLength(0)
      expect(response.body.recommendations.low).toHaveLength(0)
      expect(response.body.totalCount).toBe(0)
    })

    it('should return recommendations with correct structure when data exists', async () => {
      // Seed test data that will trigger recommendations
      gasAnalyzer.recordMetrics({
        functionName: 'expensive_function',
        cpuInstructions: 25000000, // Critical CPU
        memoryBytes: 250000, // Critical memory
        ledgerReadBytes: 10000,
        ledgerWriteBytes: 5000,
        totalFee: '60000000', // Critical fee
        timestamp: Date.now(),
      })

      const response = await request(app)
        .get('/api/gas-metrics/recommendations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.totalCount).toBeGreaterThan(0)
    })
  })

  describe('GET /api/gas-metrics/estimate/:functionName', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/estimate/test_function')
        .expect(401)

      expect(response.body.error).toBeDefined()
    })

    it('should return gas estimate for a specific function with authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/estimate/test_function')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body).toHaveProperty('functionName')
      expect(response.body).toHaveProperty('estimate')
      expect(response.body).toHaveProperty('benchmark')
      expect(response.body.functionName).toBe('test_function')
      expect(response.body.estimate).toHaveProperty('estimatedFee')
      expect(response.body.estimate).toHaveProperty('confidence')
    })

    it('should support complexity parameter', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/estimate/test_function?complexity=simple')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.functionName).toBe('test_function')
    })

    it('should handle invalid complexity parameter gracefully', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/estimate/test_function?complexity=invalid')
        .set('Authorization', `Bearer ${authToken}`)

      // Accept 200 (graceful handling) or 500 (validation error)
      expect([200, 500]).toContain(response.status)

      if (response.status === 200) {
        expect(response.body.success).toBe(true)
      }
    })

    it('should return benchmark data when available', async () => {
      gasAnalyzer.recordMetrics({
        functionName: 'test_function',
        cpuInstructions: 1000000,
        memoryBytes: 5000,
        ledgerReadBytes: 1000,
        ledgerWriteBytes: 500,
        totalFee: '100000',
        timestamp: Date.now(),
      })

      const response = await request(app)
        .get('/api/gas-metrics/estimate/test_function')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.benchmark).not.toBeNull()
    })

    it('should return null benchmark when no data exists', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/estimate/unknown_function')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.benchmark).toBeNull()
    })
  })

  describe('GET /api/gas-metrics/export', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/export')
        .expect(401)

      expect(response.body.error).toBeDefined()
    })

    it('should export all metrics as JSON with authentication', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/export')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('application/json')
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.headers['content-disposition']).toContain('gas-metrics')
    })

    it('should export valid JSON data', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/export')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      const data = JSON.parse(response.text)
      expect(data).toHaveProperty('benchmarks')
      expect(data).toHaveProperty('recommendations')
      expect(data).toHaveProperty('timestamp')
      expect(Array.isArray(data.benchmarks)).toBe(true)
      expect(Array.isArray(data.recommendations)).toBe(true)
    })

    it('should include timestamp in export', async () => {
      const response = await request(app)
        .get('/api/gas-metrics/export')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      const data = JSON.parse(response.text)
      expect(data.timestamp).toBeDefined()
      expect(new Date(data.timestamp)).toBeInstanceOf(Date)
    })
  })

  describe('Error handling', () => {
    it('should return 500 when gas analyzer fails', async () => {
      vi.spyOn(gasAnalyzer, 'getAllBenchmarks').mockImplementationOnce(() => {
        throw new Error('Analyzer failed')
      })

      const response = await request(app)
        .get('/api/gas-metrics/benchmarks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500)

      expect(response.body.success).toBe(false)
      expect(response.body.error).toBeDefined()
    })
  })
})
