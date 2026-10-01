import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initScheduler } from '../jobs/scheduler/worker.js'
import {
  WebhookEventType,
  webhookDeliveryStore,
  webhookSubscriptionStore,
} from '../models/webhookSubscription.js'
import { enqueueDelivery, processWebhookDeliveryJob } from './webhookDeliveryService.js'

describe('webhookDeliveryService', () => {
  beforeEach(() => {
    webhookSubscriptionStore.clear()
    initScheduler({ schedule: vi.fn() } as any)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('schedules retry with backoff and request timeout when delivery fails', async () => {
    const schedule = vi.fn()
    initScheduler({ schedule } as any)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')) as any)

    const sub = await webhookSubscriptionStore.create({
      ownerId: 'owner-1',
      targetUrl: 'https://example.com/hooks/payments',
      secret: 'hashed_secret',
      events: [WebhookEventType.PAYMENT_RECEIVED],
    })

    const startedAt = Date.now()
    await processWebhookDeliveryJob({
      subscriptionId: sub.id,
      event: WebhookEventType.PAYMENT_RECEIVED,
      payload: { paymentId: 'pay_1' },
      attemptCount: 0,
    })

    const [retryJob] = schedule.mock.calls[0]
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(retryJob.payload.attemptCount).toBe(1)
    expect(retryJob.nextRunAt).toBeInstanceOf(Date)
    const delayMs = retryJob.nextRunAt.getTime() - startedAt
    expect(delayMs).toBeGreaterThanOrEqual(59_000)
    expect(delayMs).toBeLessThanOrEqual(61_000)

    const history = await webhookDeliveryStore.getHistoryBySubscription(sub.id)
    expect(history[0]?.status).toBe('failed')
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      signal: expect.any(AbortSignal),
    })
  })

  it('dead-letters delivery after max attempts without disabling subscription', async () => {
    const schedule = vi.fn()
    initScheduler({ schedule } as any)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('subscriber timeout')) as any)

    const sub = await webhookSubscriptionStore.create({
      ownerId: 'owner-2',
      targetUrl: 'https://example.com/hooks/status',
      secret: 'hashed_secret',
      events: [WebhookEventType.DEAL_ACTIVATED],
    })

    await processWebhookDeliveryJob({
      subscriptionId: sub.id,
      event: WebhookEventType.DEAL_ACTIVATED,
      payload: { dealId: 'deal_1' },
      attemptCount: 4,
    })

    expect(schedule).not.toHaveBeenCalled()
    const history = await webhookDeliveryStore.getHistoryBySubscription(sub.id)
    expect(history[0]?.status).toBe('permanently_failed')
    expect((await webhookSubscriptionStore.findById(sub.id))?.active).toBe(true)
  })

  it('enqueues one delivery job per active subscriber', async () => {
    const schedule = vi.fn()
    initScheduler({ schedule } as any)

    await webhookSubscriptionStore.create({
      ownerId: 'owner-a',
      targetUrl: 'https://example.com/hooks/a',
      secret: 'hashed_secret_a',
      events: [WebhookEventType.PAYMENT_RECEIVED],
    })
    await webhookSubscriptionStore.create({
      ownerId: 'owner-b',
      targetUrl: 'https://example.com/hooks/b',
      secret: 'hashed_secret_b',
      events: [WebhookEventType.PAYMENT_RECEIVED],
    })

    await enqueueDelivery(WebhookEventType.PAYMENT_RECEIVED, { paymentId: 'pay_2' })

    expect(schedule).toHaveBeenCalledTimes(2)
    for (const [job] of schedule.mock.calls) {
      expect(job.handler).toBe('webhook.delivery')
      expect(job.payload.attemptCount).toBe(0)
      expect(job.maxRetries).toBe(0)
    }
  })
})
