import { describe, it, expect } from 'vitest'
import { AppError } from './AppError.js'
import { ErrorCode, classifyError, ERROR_CLASSIFICATION } from './errorCodes.js'

describe('AppError classification', () => {
  it('marks validation errors as permanent', () => {
    const err = new AppError(ErrorCode.VALIDATION_ERROR, 400, 'bad input')
    expect(err.classification).toBe('permanent')
    expect(err.retryable).toBe(false)
  })

  it('marks soroban errors as transient', () => {
    const err = new AppError(ErrorCode.SOROBAN_ERROR, 502, 'rpc down')
    expect(err.classification).toBe('transient')
    expect(err.retryable).toBe(true)
  })

  it('marks internal errors as transient', () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, 500, 'something broke')
    expect(err.classification).toBe('transient')
    expect(err.retryable).toBe(true)
  })

  it('marks not-found as permanent', () => {
    const err = new AppError(ErrorCode.NOT_FOUND, 404, 'missing')
    expect(err.classification).toBe('permanent')
    expect(err.retryable).toBe(false)
  })

  it('marks service unavailable as transient', () => {
    const err = new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, 'try later')
    expect(err.classification).toBe('transient')
    expect(err.retryable).toBe(true)
  })
})

describe('classifyError', () => {
  it('returns permanent for unknown error codes', () => {
    expect(classifyError('UNKNOWN_CODE')).toBe('permanent')
  })

  it('classifies all known error codes', () => {
    for (const code of Object.values(ErrorCode)) {
      const classification = classifyError(code)
      expect(['transient', 'permanent']).toContain(classification)
    }
  })
})

describe('ERROR_CLASSIFICATION', () => {
  it('covers all error codes', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_CLASSIFICATION[code]).toBeDefined()
    }
  })
})
