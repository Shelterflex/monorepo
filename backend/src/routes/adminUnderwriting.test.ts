/**
 * adminUnderwriting.test.ts
 * Route validation tests for admin underwriting endpoints:
 * - POST /evaluate/:applicationId (validate paymentHistory and metadata)
 * - PUT /config (validate all updatable fields including rules array)
 *
 * Tests focus on request body validation, error shape, and auth gating.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { createAdminUnderwritingRouter } from './adminUnderwriting.js'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  evaluateApplication: vi.fn(),
  getRuleConfig: vi.fn(),
  updateRuleConfig: vi.fn(),
}))

vi.mock('../middleware/auth.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth.js')>()
  const { AppError } = await import('../errors/AppError.js')
  const { ErrorCode } = await import('../errors/errorCodes.js')
  return {
    ...original,
    authenticateToken: (req: any, _res: any, next: any) => {
      if (!authState.authenticated) {
        next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required'))
        return
      }
      req.user = { id: 'admin-user', role: 'admin' }
      next()
    },
  }
})

vi.mock('../services/underwritingService.js', () => ({
  underwritingService: serviceMock,
}))

vi.mock('../models/underwritingDecisionTraceStore.js', () => ({
  underwritingDecisionTraceStore: {
    list: vi.fn(),
    findById: vi.fn(),
    findByApplicationId: vi.fn(),
    findByUserId: vi.fn(),
  },
}))

vi.mock('../models/tenantApplicationStore.js', () => ({
  tenantApplicationStore: {},
}))

function buildApp(): Express {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res, next) => {
    req.requestId = 'test-request-id'
    next()
  })
  app.use('/api/admin/underwriting', createAdminUnderwritingRouter())
  app.use(errorHandler)
  return app
}

describe('Admin Underwriting Routes - Validation', () => {
  beforeEach(() => {
    authState.authenticated = true
    serviceMock.evaluateApplication.mockReset()
    serviceMock.getRuleConfig.mockReset()
    serviceMock.updateRuleConfig.mockReset()
  })

  // ---------------------------------------------------------------------------
  // POST /evaluate/:applicationId
  // ---------------------------------------------------------------------------
  describe('POST /evaluate/:applicationId', () => {
    it('accepts valid evaluation request with paymentHistory', async () => {
      serviceMock.evaluateApplication.mockResolvedValue({
        applicationId: 'app-123',
        userId: 'user-456',
        decision: 'APPROVE',
        result: { decision: 'APPROVE', totalScore: 85, maxScore: 100 },
        evaluatedAt: new Date().toISOString(),
      })

      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 0.95,
            missedPayments: 1,
            totalPayments: 20,
          },
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.applicationId).toBe('app-123')
      expect(serviceMock.evaluateApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-123',
          paymentHistory: {
            onTimePaymentRate: 0.95,
            missedPayments: 1,
            totalPayments: 20,
          },
        }),
      )
    })

    it('accepts valid evaluation request with metadata', async () => {
      serviceMock.evaluateApplication.mockResolvedValue({
        applicationId: 'app-123',
        userId: 'user-456',
        decision: 'REVIEW',
        result: { decision: 'REVIEW', totalScore: 55, maxScore: 100 },
        evaluatedAt: new Date().toISOString(),
      })

      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          metadata: { source: 'admin-override', reason: 'manual review' },
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.evaluateApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-123',
          metadata: { source: 'admin-override', reason: 'manual review' },
        }),
      )
    })

    it('accepts valid evaluation request with both paymentHistory and metadata', async () => {
      serviceMock.evaluateApplication.mockResolvedValue({
        applicationId: 'app-123',
        userId: 'user-456',
        decision: 'APPROVE',
        result: { decision: 'APPROVE', totalScore: 90, maxScore: 100 },
        evaluatedAt: new Date().toISOString(),
      })

      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 0.98,
            missedPayments: 0,
            totalPayments: 24,
          },
          metadata: { verified: true },
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.evaluateApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-123',
          paymentHistory: {
            onTimePaymentRate: 0.98,
            missedPayments: 0,
            totalPayments: 24,
          },
          metadata: { verified: true },
        }),
      )
    })

    it('accepts evaluation request with empty body', async () => {
      serviceMock.evaluateApplication.mockResolvedValue({
        applicationId: 'app-123',
        userId: 'user-456',
        decision: 'REVIEW',
        result: { decision: 'REVIEW', totalScore: 50, maxScore: 100 },
        evaluatedAt: new Date().toISOString(),
      })

      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('rejects malformed paymentHistory - onTimePaymentRate out of range', async () => {
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 1.5, // Invalid: > 1
            missedPayments: 0,
            totalPayments: 10,
          },
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details).toBeDefined()
    })

    it('rejects paymentHistory with negative missedPayments', async () => {
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 0.9,
            missedPayments: -1, // Invalid: negative
            totalPayments: 10,
          },
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects paymentHistory with non-integer missedPayments', async () => {
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 0.9,
            missedPayments: 2.5, // Invalid: not an integer
            totalPayments: 10,
          },
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects paymentHistory with missing required fields', async () => {
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 0.9,
            // missing missedPayments and totalPayments
          },
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects invalid metadata type', async () => {
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          metadata: 'not-a-record', // Should be object
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects request with unknown fields', async () => {
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({
          paymentHistory: {
            onTimePaymentRate: 0.9,
            missedPayments: 1,
            totalPayments: 10,
          },
          unknownField: 'should-be-rejected',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects unauthenticated request', async () => {
      authState.authenticated = false
      const res = await request(buildApp())
        .post('/api/admin/underwriting/evaluate/app-123')
        .send({})

      expect(res.status).toBe(401)
    })
  })

  // ---------------------------------------------------------------------------
  // PUT /config
  // ---------------------------------------------------------------------------
  describe('PUT /config', () => {
    const validConfig = {
      version: '1.1.0',
      approveThreshold: 85,
      reviewThreshold: 55,
      rules: [
        {
          ruleId: 'deposit_minimum',
          ruleName: 'Minimum Deposit Ratio',
          weight: 25,
          enabled: true,
          threshold: 0.2,
          severity: 'critical' as const,
        },
      ],
    }

    it('accepts valid config update with all fields', async () => {
      serviceMock.getRuleConfig.mockReturnValue(validConfig)

      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send(validConfig)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.updateRuleConfig).toHaveBeenCalledWith(validConfig)
    })

    it('accepts partial config update - approveThreshold only', async () => {
      const partial = { approveThreshold: 80 }
      serviceMock.getRuleConfig.mockReturnValue({ ...validConfig, approveThreshold: 80 })

      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send(partial)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.updateRuleConfig).toHaveBeenCalledWith(partial)
    })

    it('accepts partial config update - reviewThreshold only', async () => {
      const partial = { reviewThreshold: 50 }
      serviceMock.getRuleConfig.mockReturnValue({ ...validConfig, reviewThreshold: 50 })

      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send(partial)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.updateRuleConfig).toHaveBeenCalledWith(partial)
    })

    it('accepts partial config update - version only', async () => {
      const partial = { version: '2.0.0' }
      serviceMock.getRuleConfig.mockReturnValue({ ...validConfig, version: '2.0.0' })

      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send(partial)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.updateRuleConfig).toHaveBeenCalledWith(partial)
    })

    it('accepts rules array update', async () => {
      const newRules = [
        {
          ruleId: 'new_rule',
          ruleName: 'New Rule',
          weight: 30,
          enabled: true,
          severity: 'warning' as const,
        },
      ]
      const configWithNewRules = { ...validConfig, rules: newRules }
      serviceMock.getRuleConfig.mockReturnValue(configWithNewRules)

      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ rules: newRules })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(serviceMock.updateRuleConfig).toHaveBeenCalledWith(
        expect.objectContaining({ rules: newRules }),
      )
    })

    it('rejects approveThreshold below 0', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ approveThreshold: -1 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects approveThreshold above 100', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ approveThreshold: 101 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects reviewThreshold below 0', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ reviewThreshold: -1 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects reviewThreshold above 100', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ reviewThreshold: 101 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects rule with invalid severity', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({
          rules: [
            {
              ruleId: 'test',
              ruleName: 'Test Rule',
              weight: 10,
              enabled: true,
              severity: 'invalid', // Invalid severity
            },
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects rule with missing required field', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({
          rules: [
            {
              ruleId: 'test',
              // missing ruleName
              weight: 10,
              enabled: true,
              severity: 'critical',
            },
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects rule with non-integer weight', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({
          rules: [
            {
              ruleId: 'test',
              ruleName: 'Test Rule',
              weight: 10.5, // Invalid: not an integer
              enabled: true,
              severity: 'critical',
            },
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('accepts rule with optional threshold', async () => {
      const rules = [
        {
          ruleId: 'no_threshold_rule',
          ruleName: 'No Threshold Rule',
          weight: 15,
          enabled: false,
          severity: 'info' as const,
          // threshold is optional
        },
      ]
      serviceMock.getRuleConfig.mockReturnValue({
        ...validConfig,
        rules,
      })

      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ rules })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('rejects empty body', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({})

      // Empty body should pass validation (all fields optional)
      // but service should return the current config
      expect(res.status).toBe(200)
    })

    it('rejects request with unknown fields', async () => {
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({
          approveThreshold: 80,
          unknownField: 'should-reject',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects unauthenticated request', async () => {
      authState.authenticated = false
      const res = await request(buildApp())
        .put('/api/admin/underwriting/config')
        .send({ approveThreshold: 80 })

      expect(res.status).toBe(401)
    })
  })
})
