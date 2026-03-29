import type { BackendErrorResponse } from './errors'

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

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
  const baseMessage =
    code === "ACCOUNT_FROZEN"
      ? ACCOUNT_FROZEN_MESSAGE
      : typeof typedError.message === "string"
        ? typedError.message
        : "";

  const details =
    typedError.details && typeof typedError.details === "object"
      ? (typedError.details as Record<string, unknown>)
      : undefined;

  return { message: baseMessage, code, details };
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {

  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_BACKEND_URL");
  }

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("sheltaflex_token")
      : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers ?? {}),
  };

  // Attach CSRF token for state-mutating requests (browser only)
  const method = (options?.method ?? "GET").toUpperCase();
  if (typeof window !== "undefined" && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    // Lazy-import to avoid SSR module initialization issues
    const { csrfProtection } = await import('./csrf-protection');
    const csrfToken = csrfProtection.getCurrentToken() ?? csrfProtection.initialize();
    (headers as Record<string, string>)["X-CSRF-Token"] = csrfToken;
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers,
      ...options,
    });

    if (!res.ok) {
      // Try to parse backend error response
      let errorResponse: BackendErrorResponse | null = null
      try {
        const text = await res.text()
        if (text) {
          errorResponse = JSON.parse(text) as BackendErrorResponse
        }
      } catch {
        // Not JSON, use text as message
      }

      const message = errorResponse?.error?.message || `API error: ${res.status}`
      throw new ApiError({
        message,
        status: res.status,
        code: errorResponse?.error?.code,
        details: errorResponse?.error?.details as Record<string, unknown> | undefined,
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
