import express, { type ErrorRequestHandler } from 'express'
import supertest from 'supertest'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from './errorHandler.js'

function buildApp(handler: ErrorRequestHandler = errorHandler) {
  const app = express()

  app.use((req, _res, next) => {
    req.requestId = 'middleware-test-request'
    next()
  })
  app.get('/app-error', (_req, _res, next) => {
    next(new AppError(ErrorCode.FORBIDDEN, 403, 'Access denied', { reason: 'policy' }))
  })
  app.get('/transient-error', (req, res, next) => {
    if (req.query.retryAfter === 'custom') res.setHeader('Retry-After', '17')
    next(new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, 'Try again'))
  })
  app.get('/unknown-error', (_req, _res, next) => {
    next(new Error('private database detail'))
  })
  app.get('/non-error', (_req, _res, next) => {
    next('unexpected non-error value')
  })
  app.get('/chain-error', (_req, _res, next) => {
    next(new Error('Soroban RPC request timed out'))
  })
  app.get('/validation-error', (_req, _res, next) => {
    const result = z.object({ amount: z.number() }).safeParse({ amount: 'invalid' })
    if (!result.success) next(result.error)
  })
  app.get('/malformed-json', (_req, _res, next) => {
    next(Object.assign(new SyntaxError('invalid JSON'), { body: '{' }))
  })
  app.use(handler)

  return app
}

describe('errorHandler middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('maps AppError status, details and request metadata', async () => {
    const response = await supertest(buildApp()).get('/app-error')

    expect(response.status).toBe(403)
    expect(response.headers['x-request-id']).toBe('middleware-test-request')
    expect(response.body).toEqual({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Access denied',
        details: { reason: 'policy' },
        classification: 'permanent',
        retryable: false,
      },
      requestId: 'middleware-test-request',
    })
  })

  it('adds Retry-After for transient errors without overwriting an existing value', async () => {
    const defaultResponse = await supertest(buildApp()).get('/transient-error')
    const customResponse = await supertest(buildApp()).get('/transient-error?retryAfter=custom')

    expect(defaultResponse.status).toBe(503)
    expect(defaultResponse.headers['retry-after']).toBe('5')
    expect(defaultResponse.body.error.retryable).toBe(true)
    expect(customResponse.headers['retry-after']).toBe('17')
  })

  it('maps an unavailable chain error to a retryable service error', async () => {
    const response = await supertest(buildApp()).get('/chain-error')

    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe(ErrorCode.CHAIN_UNAVAILABLE)
    expect(response.body.error.retryable).toBe(true)
  })

  it('formats Zod validation failures and malformed JSON', async () => {
    const validationResponse = await supertest(buildApp()).get('/validation-error')
    const malformedResponse = await supertest(buildApp()).get('/malformed-json')

    expect(validationResponse.status).toBe(400)
    expect(validationResponse.body.error).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid request data',
      details: { amount: expect.any(String) },
    })
    expect(malformedResponse.status).toBe(400)
    expect(malformedResponse.body.error.message).toBe('Malformed JSON in request body')
  })

  it('maps unknown errors and non-error values to safe internal errors', async () => {
    const errorResponse = await supertest(buildApp()).get('/unknown-error')
    const valueResponse = await supertest(buildApp()).get('/non-error')

    expect(errorResponse.status).toBe(500)
    expect(errorResponse.body.error.message).toBe('private database detail')
    expect(valueResponse.status).toBe(500)
    expect(valueResponse.body.error.message).toBe('An unexpected error occurred')
  })

  it('does not expose unknown error messages or stack traces in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const productionModule = await import('./errorHandler.js')
    const productionLogger = await import('../utils/logger.js')
    const errorLog = vi.spyOn(productionLogger.logger, 'error').mockImplementation(() => {})
    const response = await supertest(buildApp(productionModule.errorHandler)).get('/unknown-error')

    expect(response.status).toBe(500)
    expect(response.body.error.message).toBe('An unexpected error occurred')
    expect(JSON.stringify(response.body)).not.toContain('stack')
    expect(errorLog).toHaveBeenCalledOnce()
    expect(errorLog.mock.calls[0]?.[1]?.stack).toBeUndefined()
  })
})
