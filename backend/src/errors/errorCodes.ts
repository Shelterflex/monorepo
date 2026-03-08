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

  // Resources
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  LISTING_ALREADY_RENTED = "LISTING_ALREADY_RENTED",

  // Blockchain / Soroban
  SOROBAN_ERROR = "SOROBAN_ERROR",

  // Infrastructure
  INTERNAL_ERROR = "INTERNAL_ERROR",
}
