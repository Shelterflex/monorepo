import type { BackendErrorResponse } from './errors'
import { enqueueOfflineRequest } from './offline-queue'

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export const ACCOUNT_FROZEN_MESSAGE =
  "Account frozen due to negative balance. Please top up to continue.";

export class ApiError extends Error {
  code?: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

export function isAccountFrozenError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ACCOUNT_FROZEN";
}

function parseErrorPayload(payload: unknown): {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
} {
  if (!payload || typeof payload !== "object") {
    return { message: "" };
  }

  const maybeError = (payload as { error?: unknown }).error;
  if (!maybeError || typeof maybeError !== "object") {
    return { message: "" };
  }

  const typedError = maybeError as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };

  const code = typeof typedError.code === "string" ? typedError.code : undefined;
  let baseMessage = "";
  if (code === "ACCOUNT_FROZEN") {
    baseMessage = ACCOUNT_FROZEN_MESSAGE;
  } else if (typeof typedError.message === "string") {
    baseMessage = typedError.message;
  }

  const details =
    typedError.details && typeof typedError.details === "object"
      ? (typedError.details as Record<string, unknown>)
      : undefined;

  return { message: baseMessage, code, details };
}

function isBrowser(): boolean {
  return globalThis.window !== undefined
}

function getAuthToken(): string | null {
  return isBrowser() ? localStorage.getItem("shelterflex_token") : null
}

function isStateMutatingMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method)
}

async function attachCsrfHeaderIfNeeded(headers: Headers, method: string): Promise<void> {
  if (!isBrowser() || !isStateMutatingMethod(method)) {
    return
  }

  const { csrfProtection } = await import("./csrf-protection")
  const csrfToken = csrfProtection.getCurrentToken() ?? csrfProtection.initialize()
  headers.set("X-CSRF-Token", csrfToken)
}

function shouldQueueOfflineRequest(method: string): boolean {
  return isBrowser() && !navigator.onLine && isStateMutatingMethod(method)
}

async function parseBackendErrorResponse(
  res: Response
): Promise<BackendErrorResponse | null> {
  try {
    const text = await res.text()
    if (!text) {
      return null
    }
    return JSON.parse(text) as BackendErrorResponse
  } catch {
    return null
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_BACKEND_URL");
  }

  const token = getAuthToken()

  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const method = (options?.method ?? "GET").toUpperCase();
  await attachCsrfHeaderIfNeeded(headers, method)

  try {
    if (shouldQueueOfflineRequest(method)) {
      enqueueOfflineRequest({
        path,
        method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        body: typeof options?.body === 'string' ? options.body : null,
        headers: Object.fromEntries(headers.entries()),
      })

      return {
        queued: true,
        offline: true,
      } as T
    }

    const res = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers,
      ...options,
    });

    if (!res.ok) {
      const errorResponse = await parseBackendErrorResponse(res)
      const { message, code, details } = parseErrorPayload(errorResponse)
      throw new ApiError({
        message: message || `API error: ${res.status}`,
        status: res.status,
        code,
        details,
      })
    }

    return res.json();

  } catch (error) {
    // Re-throw ApiError as-is
    if (error instanceof ApiError) {
      throw error
    }

    // Handle network errors
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot connect to backend at ${baseUrl}. Please ensure the backend server is running.`
      );
    }
    throw error;
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
