import { describe, expect, it, vi } from 'vitest'
import {
  clearOfflineQueue,
  enqueueOfflineRequest,
  flushOfflineQueue,
  getOfflineQueueCount,
} from '@/lib/offline-queue'

describe('offline queue', () => {
  it('stores offline mutations locally', () => {
    enqueueOfflineRequest({
      path: '/api/items',
      method: 'POST',
      body: '{"value":1}',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(getOfflineQueueCount()).toBe(1)
  })

  it('flushes successful requests and clears the queue', async () => {
    enqueueOfflineRequest({
      path: '/api/items',
      method: 'POST',
      body: '{"value":1}',
      headers: { 'Content-Type': 'application/json' },
    })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    const flushed = await flushOfflineQueue('https://api.example.com')

    expect(flushed).toBe(1)
    expect(getOfflineQueueCount()).toBe(0)
    clearOfflineQueue()
  })
})
