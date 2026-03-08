import type { BackendErrorResponse } from './errors'

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

/**
 * Custom error class for API errors that preserves backend error structure
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorResponse: BackendErrorResponse | null,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
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
      throw new ApiError(res.status, errorResponse, message)
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