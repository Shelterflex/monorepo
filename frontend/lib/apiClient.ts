/**
 * Centralized API client for backend communication.
 *
 * All fetch logic flows through this module so that auth headers, error
 * handling, and base URL resolution happen in exactly one place.
 *
 * Features:
 * - Automatic retry with exponential backoff for transient failures
 * - User-friendly error messages
 * - Request correlation IDs
 */

import { ApiError, apiFetch } from "./api";
import { retryWithBackoff, type RetryOptions } from "./retryLogic";

export { ApiError, isAccountFrozenError, ACCOUNT_FROZEN_MESSAGE } from "./api";

// Default retry options for API calls
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  onRetry: (attempt, error) => {
    console.warn(
      `API call failed, retrying (attempt ${attempt}):`,
      error.message,
    );
  },
};

// ── HTTP helpers with retry logic ────────────────────────────────────────────

export async function apiGet<T>(
  path: string,
  retryOptions?: RetryOptions,
): Promise<T> {
  return retryWithBackoff(() => apiFetch<T>(path, { method: "GET" }), {
    ...DEFAULT_RETRY_OPTIONS,
    ...retryOptions,
  });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  retryOptions?: RetryOptions,
): Promise<T> {
  return retryWithBackoff(
    () =>
      apiFetch<T>(path, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    { ...DEFAULT_RETRY_OPTIONS, ...retryOptions },
  );
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  retryOptions?: RetryOptions,
): Promise<T> {
  return retryWithBackoff(
    () =>
      apiFetch<T>(path, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    { ...DEFAULT_RETRY_OPTIONS, ...retryOptions },
  );
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  retryOptions?: RetryOptions,
): Promise<T> {
  return retryWithBackoff(
    () =>
      apiFetch<T>(path, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    { ...DEFAULT_RETRY_OPTIONS, ...retryOptions },
  );
}

export async function apiDelete<T>(
  path: string,
  retryOptions?: RetryOptions,
): Promise<T> {
  return retryWithBackoff(() => apiFetch<T>(path, { method: "DELETE" }), {
    ...DEFAULT_RETRY_OPTIONS,
    ...retryOptions,
  });
}

// ── Query string helper ──────────────────────────────────────────────────────

/**
 * Build a URL path with query parameters, omitting undefined/null values.
 *
 * @example
 * withQuery("/api/items", { status: "pending", limit: 10 })
 * // => "/api/items?status=pending&limit=10"
 */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      qs.append(key, String(value));
    }
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}
