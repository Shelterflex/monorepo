import express from 'express'
import supertest from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../errors/errorCodes.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import type { FreezeReason, UserRiskState } from '../models/userRiskState.js'
import { errorHandler } from './errorHandler.js'
import { requireNotFrozen } from './risk.js'

function buildApp(userId?: string) {
  const app = express()

  app.use((req, _res, next) => {
    req.requestId = 'risk-test-request'
    if (userId) {
      req.user = {
        id: userId,
        email: 'tenant@example.test',
        name: 'Test Tenant',
        role: 'tenant',
      }
    }
    next()
  })
  app.get('/withdraw', requireNotFrozen, (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)

  return app
}

function makeRiskState(freezeReason: FreezeReason): UserRiskState {
  const now = new Date()
  return {
    userId: 'tenant-1',
    isFrozen: true,
    freezeReason,
    frozenAt: now,
    unfrozenAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('requireNotFrozen middleware', () => {
  afterEach(() => vi.restoreAllMocks())

  it('allows an authenticated user with no frozen risk state', async () => {
    vi.spyOn(userRiskStateStore, 'getByUserId').mockResolvedValue(null)

    const response = await supertest(buildApp('tenant-1')).get('/withdraw')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(userRiskStateStore.getByUserId).toHaveBeenCalledWith('tenant-1')
  })

  it.each([
    ['NEGATIVE_BALANCE', 'Negative balance detected. Please top up to continue.'],
    ['MANUAL', 'Manual freeze by admin. Contact support.'],
    ['COMPLIANCE', 'Compliance review required. Contact support.'],
  ] as const)('blocks an account frozen for %s', async (reason, explanation) => {
    vi.spyOn(userRiskStateStore, 'getByUserId').mockResolvedValue(makeRiskState(reason))

    const response = await supertest(buildApp('tenant-1')).get('/withdraw')

    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({
      code: ErrorCode.ACCOUNT_FROZEN,
      message: `Account frozen. ${explanation}`,
    })
  })

  it('rejects unauthenticated requests before looking up risk state', async () => {
    const lookup = vi.spyOn(userRiskStateStore, 'getByUserId')

    const response = await supertest(buildApp()).get('/withdraw')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe(ErrorCode.UNAUTHORIZED)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('forwards risk-state store failures to the error handler', async () => {
    vi.spyOn(userRiskStateStore, 'getByUserId').mockRejectedValue(new Error('risk store unavailable'))

    const response = await supertest(buildApp('tenant-1')).get('/withdraw')

    expect(response.status).toBe(500)
    expect(response.body.error.message).toBe('risk store unavailable')
  })
})
