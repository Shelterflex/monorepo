import { ErrorCode, classifyError, type ErrorClassification } from './errorCodes.js'

/**
 * Base class for all controlled domain errors.
 * Throw this (or a factory below) from route handlers and service logic.
 * The global `errorHandler` middleware will catch it and serialize it correctly.
 */
export class AppError extends Error {
  public readonly classification: ErrorClassification
  public readonly retryable: boolean

  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
    this.classification = classifyError(code)
    this.retryable = this.classification === 'transient'
    // Maintain proper V8 stack trace pointing to the call site, not this constructor
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError)
    }
  }
}

// Factories
// Use these instead of `new AppError(...)` directly to keep call sites concise.

export const notFound = (resource: string) =>
  new AppError(ErrorCode.NOT_FOUND, 404, `${resource} not found`)

export const unauthorized = (message = 'Authentication required') =>
  new AppError(ErrorCode.UNAUTHORIZED, 401, message)

export const forbidden = (message = 'Insufficient permissions') =>
  new AppError(ErrorCode.FORBIDDEN, 403, message)

export const conflict = (resource: string) =>
  new AppError(ErrorCode.CONFLICT, 409, `${resource} already exists`)

export const sorobanError = (message: string, details?: Record<string, unknown>) =>
  new AppError(ErrorCode.SOROBAN_ERROR, 502, message, details)

export const internalError = (message = 'An unexpected error occurred') =>
  new AppError(ErrorCode.INTERNAL_ERROR, 500, message)

export const serviceUnavailable = (message = 'Service temporarily unavailable') =>
  new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, message)
