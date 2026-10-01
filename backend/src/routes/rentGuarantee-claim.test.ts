/**
 * rentGuarantee-claim.test.ts
 * Route validation tests for POST /insurance/:policyId/claim endpoint.
 * Tests focus on request body validation, error shape, and auth gating.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { createRentGuaranteeRouter } from './rentGuarantee.js'
import type { RentGuaranteeProvider, ClaimResult } from '../services/insurance/RentGuaranteeProvider.js'

const authState = vi.hoisted(() => ({
  authenticated: true,
  role: 'landlord' as 'landlord' | 'admin' | 'tenant' | 'none',
}))

const providerMock = vi.hoisted(() => ({
  getQuote: vi.fn(),
  purchasePolicy: vi.fn(),
  cancelPolicy: vi.fn(),
  fileClaim: vi.fn(),
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
      if (authState.role === 'none') {
        req.user = null
        next()
        return
      }
      req.user = { id: 'user-123', role: authState.role }
      next()
    },
  }
})

vi.mock('../db.js', () => ({
  getPool: vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}))

vi.mock('../utils/auditLogger.js', () => ({
  auditLog: vi.fn(),
  extractAuditContext: vi.fn().mockReturnValue({}),
}))

function buildApp(): Express {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res, next) => {
    req.requestId = 'test-request-id'
    next()
  })
  app.use('/api/v1', createRentGuaranteeRouter(providerMock as any as RentGuaranteeProvider))
  app.use(errorHandler)
  return app
}

describe('Rent Guarantee - Insurance Claim Route Validation', () => {
  beforeEach(() => {
    authState.authenticated = true
    authState.role = 'landlord'
    providerMock.fileClaim.mockReset()
  })

  describe('POST /insurance/:policyId/claim', () => {
    it('accepts valid claim request with all required fields', async () => {
      const claimResult: ClaimResult = {
        claimId: 'claim-123',
        policyNumber: 'policy-123',
        status: 'submitted',
        details: {},
      }
      providerMock.fileClaim.mockResolvedValue(claimResult)

      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.claimId).toBe('claim-123')
      expect(providerMock.fileClaim).toHaveBeenCalledWith(
        'policy-123',
        expect.objectContaining({
          reason: 'non-payment',
          claimAmount: 500000,
        }),
      )
    })

    it('accepts valid claim with optional description', async () => {
      const claimResult: ClaimResult = {
        claimId: 'claim-456',
        policyNumber: 'policy-456',
        status: 'submitted',
        details: {},
      }
      providerMock.fileClaim.mockResolvedValue(claimResult)

      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-456/claim')
        .send({
          reason: 'tenant-default',
          claimAmount: 750000,
          description: 'Tenant stopped paying rent as of March 2024',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(providerMock.fileClaim).toHaveBeenCalledWith(
        'policy-456',
        expect.objectContaining({
          reason: 'tenant-default',
          claimAmount: 750000,
          description: 'Tenant stopped paying rent as of March 2024',
        }),
      )
    })

    it('accepts valid claim with optional claimDate', async () => {
      const claimResult: ClaimResult = {
        claimId: 'claim-789',
        policyNumber: 'policy-789',
        status: 'submitted',
        details: {},
      }
      providerMock.fileClaim.mockResolvedValue(claimResult)
      const testDate = '2024-03-15T10:30:00Z'

      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-789/claim')
        .send({
          reason: 'property-damage',
          claimAmount: 200000,
          claimDate: testDate,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(providerMock.fileClaim).toHaveBeenCalledWith(
        'policy-789',
        expect.objectContaining({
          claimDate: testDate,
        }),
      )
    })

    it('rejects claim with missing reason', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          claimAmount: 500000,
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with missing claimAmount', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with empty reason string', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: '',
          claimAmount: 500000,
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with reason exceeding max length', async () => {
      const longReason = 'a'.repeat(501)
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: longReason,
          claimAmount: 500000,
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with non-positive claimAmount', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 0,
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with negative claimAmount', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: -100000,
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with description exceeding max length', async () => {
      const longDescription = 'a'.repeat(2001)
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
          description: longDescription,
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with empty description string', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
          description: '',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with invalid claimDate format', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
          claimDate: 'not-a-date',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects claim with unknown fields', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
          unknownField: 'should-reject',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects unauthenticated request', async () => {
      authState.authenticated = false
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
        })

      expect(res.status).toBe(401)
    })

    it('rejects tenant user (non-landlord)', async () => {
      authState.role = 'tenant'
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
        })

      expect(res.status).toBe(403)
      expect(res.body.error.message).toContain('Only landlords')
    })

    it('accepts admin user for claim filing', async () => {
      authState.role = 'admin'
      const claimResult: ClaimResult = {
        claimId: 'claim-admin',
        policyNumber: 'policy-123',
        status: 'submitted',
        details: {},
      }
      providerMock.fileClaim.mockResolvedValue(claimResult)

      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: 500000,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('rejects claim with claimAmount as string', async () => {
      const res = await request(buildApp())
        .post('/api/v1/insurance/policy-123/claim')
        .send({
          reason: 'non-payment',
          claimAmount: '500000',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
