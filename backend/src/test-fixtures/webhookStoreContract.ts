import { describe, it, expect, beforeEach } from 'vitest'
import { webhookSubscriptionStore, webhookDeliveryStore, WebhookEventType } from '../models/webhookSubscription.js'

/**
 * Behaviour the webhook stores must show whichever backend serves them: the
 * in-memory fallback (Postgres unavailable) or Postgres itself. Shared by
 * webhookSubscription.test.ts (fallback) and webhookSubscription.postgres.test.ts
 * (real database, skipped without DATABASE_URL).
 *
 * Each test uses fresh owner/subscription ids so a shared database needs no cleanup.
 */
let counter = 0
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`

export function runWebhookStoreContract(backend: string) {
  describe(`webhook subscription store contract (${backend})`, () => {
    beforeEach(() => {
      webhookSubscriptionStore.clear()
    })

    const make = (ownerId: string, events: WebhookEventType[] = [WebhookEventType.DEAL_ACTIVATED]) =>
      webhookSubscriptionStore.create({
        ownerId,
        targetUrl: 'https://example.com/hook',
        secret: 'hashed-secret',
        events,
      })

    describe('create', () => {
      it('creates an active subscription with the given fields', async () => {
        const owner = unique('owner')
        const sub = await make(owner, [WebhookEventType.DEAL_ACTIVATED, WebhookEventType.PAYMENT_RECEIVED])

        expect(sub.id).toBeTruthy()
        expect(sub.ownerId).toBe(owner)
        expect(sub.targetUrl).toBe('https://example.com/hook')
        expect(sub.secret).toBe('hashed-secret')
        expect(sub.events).toEqual([WebhookEventType.DEAL_ACTIVATED, WebhookEventType.PAYMENT_RECEIVED])
        expect(sub.active).toBe(true)
        expect(sub.createdAt).toBeInstanceOf(Date)
      })

      it('gives every subscription a distinct id', async () => {
        const owner = unique('owner')
        const a = await make(owner)
        const b = await make(owner)

        expect(a.id).not.toBe(b.id)
      })
    })

    describe('findById', () => {
      it('returns the subscription', async () => {
        const created = await make(unique('owner'))
        const found = await webhookSubscriptionStore.findById(created.id)

        expect(found?.id).toBe(created.id)
        expect(found?.targetUrl).toBe('https://example.com/hook')
      })

      it('returns undefined for an unknown id', async () => {
        expect(await webhookSubscriptionStore.findById('00000000-0000-4000-8000-000000000000')).toBeUndefined()
      })
    })

    describe('listByOwner (per-owner scoping)', () => {
      it('returns only that owner\'s subscriptions', async () => {
        const ownerA = unique('owner-a')
        const ownerB = unique('owner-b')
        const a1 = await make(ownerA)
        const a2 = await make(ownerA)
        await make(ownerB)

        const listed = await webhookSubscriptionStore.listByOwner(ownerA)

        expect(listed.map((s) => s.id).sort()).toEqual([a1.id, a2.id].sort())
        expect(listed.every((s) => s.ownerId === ownerA)).toBe(true)
      })

      it('returns an empty list for an owner with none', async () => {
        expect(await webhookSubscriptionStore.listByOwner(unique('nobody'))).toEqual([])
      })
    })

    describe('listActiveByEvent', () => {
      it('returns active subscriptions subscribed to the event', async () => {
        const owner = unique('owner')
        const deal = await make(owner, [WebhookEventType.DEAL_COMPLETED])
        const payment = await make(owner, [WebhookEventType.PAYMENT_OVERDUE])

        const ids = (await webhookSubscriptionStore.listActiveByEvent(WebhookEventType.DEAL_COMPLETED)).map((s) => s.id)

        expect(ids).toContain(deal.id)
        expect(ids).not.toContain(payment.id)
      })

      it('excludes subscriptions that have been deactivated', async () => {
        const sub = await make(unique('owner'), [WebhookEventType.KYC_APPROVED])
        await webhookSubscriptionStore.updateActive(sub.id, false)

        const ids = (await webhookSubscriptionStore.listActiveByEvent(WebhookEventType.KYC_APPROVED)).map((s) => s.id)

        expect(ids).not.toContain(sub.id)
      })
    })

    describe('updateActive', () => {
      it('deactivates and reactivates a subscription', async () => {
        const sub = await make(unique('owner'))

        await webhookSubscriptionStore.updateActive(sub.id, false)
        expect((await webhookSubscriptionStore.findById(sub.id))?.active).toBe(false)

        await webhookSubscriptionStore.updateActive(sub.id, true)
        expect((await webhookSubscriptionStore.findById(sub.id))?.active).toBe(true)
      })

      it('does not throw for an unknown id', async () => {
        await expect(
          webhookSubscriptionStore.updateActive('00000000-0000-4000-8000-000000000000', false),
        ).resolves.toBeUndefined()
      })
    })

    describe('delete', () => {
      it('deletes a subscription and reports true', async () => {
        const sub = await make(unique('owner'))

        expect(await webhookSubscriptionStore.delete(sub.id)).toBe(true)
        expect(await webhookSubscriptionStore.findById(sub.id)).toBeUndefined()
      })

      it('reports false for an unknown id', async () => {
        expect(await webhookSubscriptionStore.delete('00000000-0000-4000-8000-000000000000')).toBe(false)
      })

      it('only removes the targeted subscription', async () => {
        const owner = unique('owner')
        const keep = await make(owner)
        const drop = await make(owner)

        await webhookSubscriptionStore.delete(drop.id)

        const ids = (await webhookSubscriptionStore.listByOwner(owner)).map((s) => s.id)
        expect(ids).toEqual([keep.id])
      })
    })
  })

  describe(`webhook delivery store contract (${backend})`, () => {
    const attempt = (subscriptionId: string, status: 'delivered' | 'failed' | 'permanently_failed' = 'delivered') =>
      webhookDeliveryStore.logAttempt({
        subscriptionId,
        event: WebhookEventType.PAYMENT_RECEIVED,
        payload: { amount: 100 },
        status,
        responseCode: status === 'delivered' ? 200 : 500,
      })

    it('logs an attempt with an id and timestamp', async () => {
      const subscriptionId = unique('sub')
      const log = await attempt(subscriptionId)

      expect(log.id).toBeTruthy()
      expect(log.subscriptionId).toBe(subscriptionId)
      expect(log.status).toBe('delivered')
      expect(log.attemptedAt).toBeInstanceOf(Date)
    })

    it('returns the history for a subscription', async () => {
      const subscriptionId = unique('sub')
      await attempt(subscriptionId, 'failed')
      await attempt(subscriptionId, 'delivered')

      const history = await webhookDeliveryStore.getHistoryBySubscription(subscriptionId)

      expect(history).toHaveLength(2)
      expect(history.map((h) => h.status).sort()).toEqual(['delivered', 'failed'])
    })

    it('scopes history per subscription', async () => {
      const a = unique('sub-a')
      const b = unique('sub-b')
      await attempt(a)
      await attempt(b)

      const history = await webhookDeliveryStore.getHistoryBySubscription(a)

      expect(history).toHaveLength(1)
      expect(history[0]?.subscriptionId).toBe(a)
    })

    it('returns an empty history for an unknown subscription', async () => {
      expect(await webhookDeliveryStore.getHistoryBySubscription(unique('none'))).toEqual([])
    })
  })
}
