import express from 'express'
import supertest from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../errors/errorCodes.js'
import { errorHandler } from './errorHandler.js'
import { requireCustodialMode, requireSigningEnabled } from './custodial.js'

vi.mock('../schemas/env.js', () => ({
  env: {
    CUSTODIAL_MODE_ENABLED: true,
    CUSTODIAL_SIGNING_PAUSED: false,
  },
}))

import { env } from '../schemas/env.js'

function buildApp(middleware: typeof requireCustodialMode | typeof requireSigningEnabled) {
  const app = express()

  app.use((req, _res, next) => {
    req.requestId = 'custodial-test-request'
    next()
  })
  app.post('/wallet/sign', middleware, (_req, res) => {
    res.json({ signed: true })
  })
  app.use(errorHandler)

  return app
}

describe('custodial middleware', () => {
  afterEach(() => {
    env.CUSTODIAL_MODE_ENABLED = true
    env.CUSTODIAL_SIGNING_PAUSED = false
    vi.restoreAllMocks()
  })

  it('allows operations when custodial mode is enabled', async () => {
    const response = await supertest(buildApp(requireCustodialMode)).post('/wallet/sign')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ signed: true })
  })

  it('denies wallet operations when custodial mode is disabled', async () => {
    env.CUSTODIAL_MODE_ENABLED = false

    const response = await supertest(buildApp(requireCustodialMode)).post('/wallet/sign')

    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Custodial mode is disabled',
    })
  })

  it('allows signing when custodial signing is not paused', async () => {
    const response = await supertest(buildApp(requireSigningEnabled)).post('/wallet/sign')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ signed: true })
  })

  it('denies signing when custodial signing is paused', async () => {
    env.CUSTODIAL_SIGNING_PAUSED = true

    const response = await supertest(buildApp(requireSigningEnabled)).post('/wallet/sign')

    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Custodial signing is temporarily paused',
    })
  })
})
