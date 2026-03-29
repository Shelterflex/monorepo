/**
 * Executes an async operation with exponential-backoff retries for transient errors.
 *
 * @param fn        The async function to execute.
 * @param opts      Retry options.
 * @returns         The resolved value of `fn`.
 * @throws          The last error after all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number
    baseDelayMs?: number
    shouldRetry?: (err: unknown) => boolean
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 500
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt >= maxAttempts || !shouldRetry(err)) {
        throw err
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError
}

/**
 * Default retry predicate. Retries on common transient error patterns:
 * - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 * - Database connection errors
 * - 5xx-like status indicators
 */
function defaultShouldRetry(err: unknown): boolean {
  if (!(err instanceof Error)) return false

  const message = err.message.toLowerCase()
  const transientPatterns = [
    'econnreset',
    'econnrefused',
    'etimedout',
    'epipe',
    'connection terminated',
    'connection lost',
    'too many connections',
    'deadlock',
    'lock timeout',
    'temporarily unavailable',
    'network error',
  ]

  return transientPatterns.some((pattern) => message.includes(pattern))
}
