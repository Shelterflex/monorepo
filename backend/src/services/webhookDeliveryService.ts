import crypto from 'node:crypto'
import { getScheduler } from '../jobs/scheduler/index.js'
import {
  WebhookEventType,
  webhookSubscriptionStore,
  webhookDeliveryStore,
} from '../models/webhookSubscription.js'
import { logger } from '../utils/logger.js'
import { revalidateUrlForSSRF } from '../utils/ssrfProtection.js'

const MAX_DELIVERY_ATTEMPTS = 5
const DELIVERY_TIMEOUT_MS = parseInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? '10000', 10)

// Exponential backoff values in milliseconds: 1m, 5m, 30m, 2h, 8h
const BACKOFF_MS = [
  60 * 1000,          // 1 minute
  5 * 60 * 1000,      // 5 minutes
  30 * 60 * 1000,     // 30 minutes
  2 * 60 * 60 * 1000, // 2 hours
  8 * 60 * 60 * 1000  // 8 hours
]

export function computeHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export async function enqueueDelivery(
  event: WebhookEventType,
  payload: Record<string, unknown>,
  options?: { requestId?: string }
): Promise<void> {
  const activeSubs = await webhookSubscriptionStore.listActiveByEvent(event)
  const scheduler = getScheduler()

  for (const sub of activeSubs) {
    const jobPayload = {
      subscriptionId: sub.id,
      event,
      payload,
      attemptCount: 0,
      requestId: options?.requestId,
    }

    await scheduler.schedule({
      name: `webhook.delivery.${sub.id}.${Date.now()}`,
      handler: 'webhook.delivery',
      payload: jobPayload,
      maxRetries: 0 // Handled manually to respect exact backoff tiers
    })
  }
}

export async function processWebhookDeliveryJob(jobPayload: {
  subscriptionId: string
  event: WebhookEventType
  payload: Record<string, unknown>
  attemptCount: number
  requestId?: string
}): Promise<void> {
  const { subscriptionId, event, payload, attemptCount, requestId } = jobPayload
  const sub = await webhookSubscriptionStore.findById(subscriptionId)
  if (!sub || !sub.active) {
    return
  }

  // Revalidate URL for SSRF protection at delivery time
  if (!revalidateUrlForSSRF(sub.targetUrl)) {
    logger.warn('Webhook delivery blocked due to SSRF protection', {
      subscriptionId,
      targetUrl: sub.targetUrl,
      requestId,
    })
    await webhookDeliveryStore.logAttempt({
      subscriptionId,
      event,
      payload,
      status: 'permanently_failed',
      responseCode: 403,
      responseBody: 'URL blocked by SSRF protection',
      requestId,
    })
    return
  }

  const currentAttempt = attemptCount + 1
  const bodyString = JSON.stringify(payload)
  
  // HMAC-SHA256 signature calculated from shared secret hash
  const signature = computeHmacSignature(bodyString, sub.secret)

  let responseCode: number | undefined
  let responseBody = ''
  let status: 'delivered' | 'failed' | 'permanently_failed' = 'failed'

  try {
    const res = await fetch(sub.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body: bodyString,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })

    responseCode = res.status
    responseBody = await res.text()
    if (res.status >= 200 && res.status < 300) {
      status = 'delivered'
    }
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err)
  }

  const truncatedBody = responseBody.slice(0, 500)

  await webhookDeliveryStore.logAttempt({
    subscriptionId,
    event,
    payload,
    status: status === 'delivered' ? 'delivered' : (currentAttempt >= MAX_DELIVERY_ATTEMPTS ? 'permanently_failed' : 'failed'),
    responseCode,
    responseBody: truncatedBody,
    requestId,
  })

  if (status === 'delivered') {
    return
  }

  if (currentAttempt < MAX_DELIVERY_ATTEMPTS) {
    const delay = BACKOFF_MS[currentAttempt - 1] || 60 * 1000
    const nextRunAt = new Date(Date.now() + delay)

    await getScheduler().schedule({
      name: `webhook.delivery.${subscriptionId}.retry.${currentAttempt}.${Date.now()}`,
      handler: 'webhook.delivery',
      payload: {
        subscriptionId,
        event,
        payload,
        attemptCount: currentAttempt,
        requestId,
      },
      nextRunAt,
      maxRetries: 0
    })
  } else {
    logger.warn('webhook.delivery.dead_lettered', {
      subscriptionId,
      event,
      attempts: currentAttempt,
      targetUrl: sub.targetUrl,
    })
  }
}
