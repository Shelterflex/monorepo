/**
 * Retry logic with exponential backoff and jitter for API calls
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatusCodes?: number[];
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  onRetry: () => {},
};

/**
 * Check if an error is retryable
 */
function isRetryableError(
  error: unknown,
  retryableStatusCodes: number[],
): boolean {
  // Network errors are always retryable
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  // Check for retryable HTTP status codes
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as any).status;
    return retryableStatusCodes.includes(status);
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
): number {
  const exponentialDelay =
    initialDelayMs * Math.pow(backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (random value between 0 and 25% of delay)
  const jitter = Math.random() * cappedDelay * 0.25;

  return cappedDelay + jitter;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff and jitter
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error("Retry failed");

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this is the last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Don't retry if error is not retryable
      if (!isRetryableError(error, opts.retryableStatusCodes)) {
        throw lastError;
      }

      // Calculate delay and notify
      const delay = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier,
      );

      opts.onRetry(attempt + 1, lastError);

      // Wait before retrying
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of a function
 */
export function withRetry<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RetryOptions = {},
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs) => {
    return retryWithBackoff(() => fn(...args), options);
  };
}
