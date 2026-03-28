import { AppError } from "./AppError.js"
import { ErrorCode } from "./errorCodes.js"

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