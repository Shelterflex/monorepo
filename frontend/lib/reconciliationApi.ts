import { apiFetch, apiPost } from './api'

export interface OutboxItem {
  id: string
  txType: string
  txId: string
  externalRef: string
  status: 'pending' | 'sent' | 'failed'
  attempts: number
  lastError?: string
  createdAt: string
  updatedAt: string
  payload: Record<string, unknown>
}

export interface OutboxResponse {
  items: OutboxItem[]
  total: number
}

export interface RetryOutboxResponse {
  success: boolean
  item: {
    id: string
    txId: string
    status: string
    attempts: number
    lastError?: string
    updatedAt: string
  }
  message: string
}

export interface RetryAllResponse {
  success: boolean
  succeeded: number
  failed: number
  message: string
}

/**
 * Get outbox items, optionally filtered by status
 */
export async function getOutboxItems(params?: {
  status?: 'pending' | 'sent' | 'failed'
  limit?: number
}): Promise<OutboxResponse> {
  const queryParams = new URLSearchParams()
  if (params?.status) {
    queryParams.append('status', params.status)
  }
  if (params?.limit) {
    queryParams.append('limit', String(params.limit))
  }

  const query = queryParams.toString()
  return apiFetch<OutboxResponse>(`/api/admin/outbox${query ? `?${query}` : ''}`)
}

/**
 * Retry a specific outbox item
 */
export async function retryOutboxItem(id: string): Promise<RetryOutboxResponse> {
  return apiPost<RetryOutboxResponse>(`/api/admin/outbox/${id}/retry`, {})
}

/**
 * Retry all failed outbox items
 */
export async function retryAllOutboxItems(): Promise<RetryAllResponse> {
  return apiPost<RetryAllResponse>('/api/admin/outbox/retry-all', {})
}
