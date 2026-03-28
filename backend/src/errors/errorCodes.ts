/**
 * Canonical error response shape returned by every endpoint.
 *
 * @example
 * // 404 – resource not found
 * {
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Property with id 'abc-123' was not found"
 *   }
 * }
 *
 * @example
 * // 400 – validation failure
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Request validation failed",
 *     "details": {
 *       "fields": [{ "field": "amount", "message": "Expected number, received string" }]
 *     }
 *   }
 * }
 */
export interface ErrorResponse {
  error: {
    /** Machine-readable code — use `ErrorCode` constants to populate this. */
    code: string
    /** Human-readable explanation safe to surface to the client. */
    message: string
    /** Optional structured context (field errors, upstream details, etc.). */
    details?: Record<string, unknown>
  }
}

/**
 * Error classification for retry and monitoring decisions.
 *
 * - `transient`: Temporary failures that may succeed on retry (network, timeouts, 5xx).
 * - `permanent`: Deterministic failures that will not resolve with retries (validation, auth).
 */
export type ErrorClassification = 'transient' | 'permanent'

/**
 * Exhaustive catalog of error codes used across the backend.
 *
 * Rules:
 *  - Every new error type MUST be added here before use.
 *  - Keep values identical to the key (SCREAMING_SNAKE_CASE).
 *  - Frontend i18n keys should mirror these values.
 */
export enum ErrorCode {
  // Input / contract
  VALIDATION_ERROR = "VALIDATION_ERROR",

  // Auth
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",

  // Rate limiting
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",

  // Resources
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  LISTING_ALREADY_RENTED = "LISTING_ALREADY_RENTED",

  // Blockchain / Soroban
  SOROBAN_ERROR = "SOROBAN_ERROR",

  // Payment providers / PSP
  PAYMENT_PROVIDER_ERROR = "PAYMENT_PROVIDER_ERROR",

  // Infrastructure
  INTERNAL_ERROR = "INTERNAL_ERROR",

  // Risk & Compliance
  ACCOUNT_FROZEN = "ACCOUNT_FROZEN",

  // Service unavailable (transient)
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",

  // Idempotency
  DUPLICATE_REQUEST = "DUPLICATE_REQUEST",

  // Deprecation
  API_VERSION_DEPRECATED = "API_VERSION_DEPRECATED",
}

/**
 * Maps error codes to their classification.
 * Transient errors are safe to retry; permanent errors should not be retried.
 */
export const ERROR_CLASSIFICATION: Record<string, ErrorClassification> = {
  [ErrorCode.VALIDATION_ERROR]: 'permanent',
  [ErrorCode.UNAUTHORIZED]: 'permanent',
  [ErrorCode.FORBIDDEN]: 'permanent',
  [ErrorCode.TOO_MANY_REQUESTS]: 'transient',
  [ErrorCode.NOT_FOUND]: 'permanent',
  [ErrorCode.CONFLICT]: 'permanent',
  [ErrorCode.LISTING_ALREADY_RENTED]: 'permanent',
  [ErrorCode.SOROBAN_ERROR]: 'transient',
  [ErrorCode.PAYMENT_PROVIDER_ERROR]: 'transient',
  [ErrorCode.INTERNAL_ERROR]: 'transient',
  [ErrorCode.ACCOUNT_FROZEN]: 'permanent',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'transient',
  [ErrorCode.DUPLICATE_REQUEST]: 'permanent',
  [ErrorCode.API_VERSION_DEPRECATED]: 'permanent',
}

/**
 * Returns the classification for a given error code.
 */
export function classifyError(code: string): ErrorClassification {
  return ERROR_CLASSIFICATION[code] ?? 'permanent'
}
