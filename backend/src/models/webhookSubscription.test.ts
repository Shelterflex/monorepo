import { describe, it, expect, vi, beforeEach } from 'vitest'

// Postgres is "down": every repository call rejects, so the stores serve from
// their in-memory fallback.
const down = (code?: string) => async () => {
  throw Object.assign(new Error('connection refused to db.internal user=alice@example.com'), { code })
}

vi.mock('../repositories/WebhookRepository.js', () => ({
  PostgresWebhookSubscriptionRepository: class {
    create = down('ECONNREFUSED')
    findById = down()
    listByOwner = down()
    listActiveByEvent = down()
    delete = down()
    updateActive = down()
  },
  PostgresWebhookDeliveryLogRepository: class {
    logAttempt = down()
    getHistoryBySubscription = down()
  },
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '../utils/logger.js'
import { webhookSubscriptionStore, webhookDeliveryStore, WebhookEventType } from './webhookSubscription.js'
import { runWebhookStoreContract } from '../test-fixtures/webhookStoreContract.js'

runWebhookStoreContract('in-memory fallback')

describe('webhook stores log through the structured logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webhookSubscriptionStore.clear()
  })

  it('does not write to console when Postgres fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await webhookSubscriptionStore.create({
      ownerId: 'o1',
      targetUrl: 'https://example.com',
      secret: 's',
      events: [WebhookEventType.DEAL_ACTIVATED],
    })

    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    warn.mockRestore()
    log.mockRestore()
    error.mockRestore()
  })

  it.each([
    ['create', () => webhookSubscriptionStore.create({ ownerId: 'o', targetUrl: 'https://e.com', secret: 's', events: [] })],
    ['findById', () => webhookSubscriptionStore.findById('x')],
    ['listByOwner', () => webhookSubscriptionStore.listByOwner('o')],
    ['listActiveByEvent', () => webhookSubscriptionStore.listActiveByEvent(WebhookEventType.DEAL_ACTIVATED)],
    ['delete', () => webhookSubscriptionStore.delete('x')],
    ['updateActive', () => webhookSubscriptionStore.updateActive('x', true)],
    [
      'logAttempt',
      () =>
        webhookDeliveryStore.logAttempt({
          subscriptionId: 's',
          event: WebhookEventType.DEAL_ACTIVATED,
          payload: {},
          status: 'failed',
        }),
    ],
    ['getHistoryBySubscription', () => webhookDeliveryStore.getHistoryBySubscription('s')],
  ])('%s records one structured warning via logger.warn', async (_name, run) => {
    await run()

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [message, fields] = vi.mocked(logger.warn).mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toMatch(/in-memory fallback/)
    expect(fields).toHaveProperty('operation')
    expect(fields).toHaveProperty('errorName')
  })

  it('logs the error code but never the raw database message', async () => {
    await webhookSubscriptionStore.create({
      ownerId: 'o',
      targetUrl: 'https://e.com',
      secret: 's',
      events: [],
    })

    const [, fields] = vi.mocked(logger.warn).mock.calls[0] as [string, Record<string, unknown>]
    expect(fields.errorCode).toBe('ECONNREFUSED')
    expect(JSON.stringify(fields)).not.toContain('alice@example.com')
    expect(JSON.stringify(fields)).not.toContain('db.internal')
  })
})
