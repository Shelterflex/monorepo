import { apiGet, apiPost, withQuery } from "./apiClient"
import { apiFetch } from "./api"

export type QuotaOverride = {
  userId: string
  endpoint?: string
  elevatedLimit: number
  reason: string
  createdBy: string
  createdAt: number
  expiresAt?: number
}

export type QuotaUsage = {
  userId: string
  endpoint: string
  minuteUsage: number
  dayUsage: number
  minuteLimit: number
  dayLimit: number
  minuteReset: number
  dayReset: number
  nearLimit: boolean
}

export type QuotaStats = {
  totalOverrides: number
  activeOverrides: number
  [key: string]: unknown
}

export async function fetchQuotaUsage(userId: string, endpoint?: string): Promise<QuotaUsage> {
  return apiGet<QuotaUsage>(
    withQuery(`/api/admin/quota/usage/${encodeURIComponent(userId)}`, { endpoint }),
  )
}

export async function fetchQuotaOverrides(userId: string): Promise<QuotaOverride[]> {
  const res = await apiGet<{ overrides: QuotaOverride[] }>(
    `/api/admin/quota/overrides/${encodeURIComponent(userId)}`,
  )
  return res.overrides
}

export async function createQuotaOverride(params: {
  userId: string
  endpoint?: string
  elevatedLimit: number
  reason: string
  expiresAt?: number
}): Promise<{ success: boolean; override: QuotaOverride }> {
  return apiPost<{ success: boolean; override: QuotaOverride }>(
    "/api/admin/quota/override",
    params,
  )
}

export async function removeQuotaOverride(userId: string, endpoint?: string): Promise<{ success: boolean }> {
  // The backend validates userId/endpoint on the DELETE body (not query
  // params), so this goes through apiFetch directly rather than apiClient's
  // bodyless apiDelete helper.
  return apiFetch<{ success: boolean }>("/api/admin/quota/override", {
    method: "DELETE",
    body: JSON.stringify({ userId, endpoint }),
  })
}

export async function fetchQuotaStats(): Promise<QuotaStats> {
  return apiGet<QuotaStats>("/api/admin/quota/stats")
}

export async function resetQuota(userId: string, endpoint?: string): Promise<{ success: boolean }> {
  return apiPost<{ success: boolean }>("/api/admin/quota/reset", { userId, endpoint })
}
