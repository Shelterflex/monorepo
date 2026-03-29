import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { recordRequest, recordKPI, getMetricsSnapshot, metricsMiddleware } from './appMetrics.js'

// Reset internal state between tests by re-importing with fresh module
// (vitest isolates modules between test files but not within; we test
//  the pure functions directly instead)

describe('appMetrics', () => {
  describe('getMetricsSnapshot', () => {
    it('returns a valid snapshot structure', () => {
      const snap = getMetricsSnapshot()
      expect(snap).toHaveProperty('uptimeSeconds')
      expect(snap).toHaveProperty('collectedAt')
      expect(snap).toHaveProperty('routes')
      expect(snap).toHaveProperty('kpis')
      expect(snap).toHaveProperty('totalRequests')
      expect(snap).toHaveProperty('overallAlertLevel')
      expect(['ok', 'warn', 'error']).toContain(snap.overallAlertLevel)
    })

    it('accumulates request counts correctly', () => {
      const route = 'GET /test-accumulate'
      const before = getMetricsSnapshot()
      const prevCount = before.routes.find(r => r.route === route)?.requestCount ?? 0

      recordRequest(route, 200, 50)
      recordRequest(route, 200, 80)
      recordRequest(route, 500, 200)

      const snap = getMetricsSnapshot()
      const r = snap.routes.find(r => r.route === route)!
      expect(r.requestCount).toBe(prevCount + 3)
      expect(r.errorCount).toBeGreaterThanOrEqual(1)
      expect(r.errorRatePct).toBeGreaterThan(0)
    })

    it('computes latency histogram with p50/p95/p99', () => {
      const route = 'GET /test-latency'
      // Feed 10 requests with known latencies
      for (let i = 1; i <= 10; i++) recordRequest(route, 200, i * 10)

      const r = getMetricsSnapshot().routes.find(r => r.route === route)!
      expect(r.latency.count).toBeGreaterThanOrEqual(10)
      expect(r.latency.p50).toBeGreaterThan(0)
      expect(r.latency.p99).toBeGreaterThanOrEqual(r.latency.p50)
      expect(r.latency.sum).toBeGreaterThan(0)
    })

    it('sets alertLevel to error when error rate exceeds threshold', () => {
      const route = 'GET /test-alert-error'
      // 100% error rate
      for (let i = 0; i < 10; i++) recordRequest(route, 500, 100)

      const r = getMetricsSnapshot().routes.find(r => r.route === route)!
      expect(r.alertLevel).toBe('error')
    })
  })

  describe('recordKPI', () => {
    it('increments KPI counters', () => {
      const before = getMetricsSnapshot().kpis.paymentsInitiated
      recordKPI('paymentsInitiated')
      recordKPI('paymentsInitiated')
      const after = getMetricsSnapshot().kpis.paymentsInitiated
      expect(after).toBe(before + 2)
    })
  })

  describe('metricsMiddleware', () => {
    it('records requests via middleware and reflects them in snapshot', async () => {
      const app = express()
      app.use(metricsMiddleware)
      app.get('/probe', (_req, res) => res.status(200).json({ ok: true }))

      await request(app).get('/probe').expect(200)

      const snap = getMetricsSnapshot()
      const total = snap.totalRequests
      expect(total).toBeGreaterThan(0)
    })
  })
})
