/**
 * Backend error response format
 */
export interface BackendErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Parsed error for frontend use
 */
export interface ParsedError {
  code: string
  message: string
  userMessage: string
  details?: Record<string, unknown>
  statusCode?: number
}

/**
 * Maps backend error codes to user-friendly messages
 */
const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Please check your input and try again',
  UNAUTHORIZED: 'Please sign in to continue',
  FORBIDDEN: 'You do not have permission to perform this action',
  NOT_FOUND: 'The requested resource was not found',
  CONFLICT: 'This action conflicts with existing data',
  TOO_MANY_REQUESTS: 'Too many requests. Please try again later',
  SOROBAN_ERROR: 'Blockchain service is temporarily unavailable',
  INTERNAL_ERROR: 'An unexpected error occurred. Please try again',
  LISTING_ALREADY_RENTED: 'This listing is already rented',
}

/**
 * Default message for unknown errors
 */
const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again'

/**
 * Parses a backend error response into a user-friendly format
 */
export function parseBackendError(
  error: unknown,
  defaultMessage: string = DEFAULT_ERROR_MESSAGE
): ParsedError {
  // Handle BackendErrorResponse format
  if (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof (error as any).error === 'object'
  ) {
    const backendError = error as BackendErrorResponse
    const code = backendError.error.code || 'UNKNOWN_ERROR'
    const backendMessage = backendError.error.message || defaultMessage
    const userMessage =
      ERROR_MESSAGES[code] || backendMessage || defaultMessage

    return {
      code,
      message: backendMessage,
      userMessage,
      details: backendError.error.details,
    }
  }

  // Handle Error objects
  if (error instanceof Error) {
    // Try to parse JSON error message (if backend error was stringified)
    try {
      const parsed = JSON.parse(error.message)
      if (parsed.error) {
        return parseBackendError(parsed, defaultMessage)
      }
    } catch {
      // Not JSON, use error message as-is
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
      userMessage: error.message || defaultMessage,
    }
  }

  // Handle string errors
  if (typeof error === 'string') {
    return {
      code: 'UNKNOWN_ERROR',
      message: error,
      userMessage: error || defaultMessage,
    }
  }

  // Fallback for unknown error types
  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred',
    userMessage: defaultMessage,
  }
}

/**
 * Checks if an error is a network/connection error
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Cannot connect to backend')
    )
  }
  return false
}

/**
 * Gets a user-friendly error message with "Try again" suffix for unknown errors
 */
export function getUserFriendlyError(
  error: unknown,
  defaultMessage: string = DEFAULT_ERROR_MESSAGE
): string {
  const parsed = parseBackendError(error, defaultMessage)

  // For unknown errors, append "Try again"
  if (parsed.code === 'UNKNOWN_ERROR' || !ERROR_MESSAGES[parsed.code]) {
    return `${parsed.userMessage} Try again.`
  }

  return parsed.userMessage
}
