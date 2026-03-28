import { apiGet, apiPost, withQuery } from './apiClient'

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
  return apiGet<OutboxResponse>(
    withQuery('/api/admin/outbox', {
      status: params?.status,
      limit: params?.limit,
    }),
  )
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
