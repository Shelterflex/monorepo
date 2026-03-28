/**
 * Centralized API client for backend communication.
 *
 * All fetch logic flows through this module so that auth headers, error
 * handling, and base URL resolution happen in exactly one place.
 */

import { ApiError, apiFetch } from "./api";

export { ApiError, isAccountFrozenError, ACCOUNT_FROZEN_MESSAGE } from "./api";

// ── HTTP helpers ─────────────────────────────────────────────────────────────

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
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
