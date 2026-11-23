import { randomUUID } from 'node:crypto'
import {
  PostgresWebhookSubscriptionRepository,
  PostgresWebhookDeliveryLogRepository,
} from '../repositories/WebhookRepository.js'
import { logger } from '../utils/logger.js'

export enum WebhookEventType {
  DEAL_ACTIVATED = 'deal.activated',
  DEAL_COMPLETED = 'deal.completed',
  DEAL_DEFAULTED = 'deal.defaulted',
  PAYMENT_RECEIVED = 'payment.received',
  PAYMENT_OVERDUE = 'payment.overdue',
  PAYOUT_DISBURSED = 'payout.disbursed',
  KYC_APPROVED = 'kyc.approved',
  KYC_REJECTED = 'kyc.rejected'
}

export interface WebhookSubscription {
  id: string
  ownerId: string
  targetUrl: string
  secret: string // SHA-256 hash of plain secret
  events: WebhookEventType[]
  active: boolean
  createdAt: Date
}

export interface WebhookDeliveryLog {
  id: string
  subscriptionId: string
  event: WebhookEventType
  payload: Record<string, unknown>
  status: 'delivered' | 'failed' | 'permanently_failed'
  responseCode?: number
  responseBody?: string
  requestId?: string
  attemptedAt: Date
}

/**
 * Log a Postgres failure that is being absorbed by the in-memory fallback.
 * Only the operation and the error code/name are recorded: the raw database
 * error can embed row values (target URLs, hashed secrets).
 */
function logFallback(operation: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code
  logger.warn('Postgres webhook operation failed, using in-memory fallback', {
    operation,
    errorCode: typeof code === 'string' ? code : undefined,
    errorName: error instanceof Error ? error.name : typeof error,
  })
}

// Fallback in-memory storage for when Postgres is not available
const fallbackSubscriptions = new Map<string, WebhookSubscription>()
const fallbackDeliveryLogs = new Map<string, WebhookDeliveryLog[]>()

class WebhookSubscriptionStore {
  private postgresRepo = new PostgresWebhookSubscriptionRepository()

  async create(data: {
    ownerId: string
    targetUrl: string
    secret: string // Store the hashed secret
    events: WebhookEventType[]
  }): Promise<WebhookSubscription> {
    try {
      return await this.postgresRepo.create(data)
    } catch (error) {
      logFallback('Postgres webhook subscription creation failed', error)
      const sub: WebhookSubscription = {
        id: randomUUID(),
        ownerId: data.ownerId,
        targetUrl: data.targetUrl,
        secret: data.secret,
        events: data.events,
        active: true,
        createdAt: new Date(),
      }
      fallbackSubscriptions.set(sub.id, sub)
      return sub
    }
  }

  async findById(id: string): Promise<WebhookSubscription | undefined> {
    try {
      const result = await this.postgresRepo.findById(id)
      return result || undefined
    } catch (error) {
      logFallback('Postgres webhook subscription lookup failed', error)
      return fallbackSubscriptions.get(id)
    }
  }

  async listByOwner(ownerId: string): Promise<WebhookSubscription[]> {
    try {
      return await this.postgresRepo.listByOwner(ownerId)
    } catch (error) {
      logFallback('Postgres webhook subscription list by owner failed', error)
      return Array.from(fallbackSubscriptions.values()).filter(s => s.ownerId === ownerId)
    }
  }

  async listActiveByEvent(event: WebhookEventType): Promise<WebhookSubscription[]> {
    try {
      return await this.postgresRepo.listActiveByEvent(event)
    } catch (error) {
      logFallback('Postgres webhook subscription list by event failed', error)
      return Array.from(fallbackSubscriptions.values()).filter(s => s.active && s.events.includes(event))
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      return await this.postgresRepo.delete(id)
    } catch (error) {
      logFallback('Postgres webhook subscription delete failed', error)
      return fallbackSubscriptions.delete(id)
    }
  }

  async updateActive(id: string, active: boolean): Promise<void> {
    try {
      await this.postgresRepo.updateActive(id, active)
    } catch (error) {
      logFallback('Postgres webhook subscription update failed', error)
      const sub = fallbackSubscriptions.get(id)
      if (sub) {
        sub.active = active
        fallbackSubscriptions.set(id, sub)
      }
    }
  }

  clear() {
    fallbackSubscriptions.clear()
    fallbackDeliveryLogs.clear()
  }
}

class WebhookDeliveryStore {
  private postgresRepo = new PostgresWebhookDeliveryLogRepository()

  async logAttempt(log: Omit<WebhookDeliveryLog, 'id' | 'attemptedAt'>): Promise<WebhookDeliveryLog> {
    try {
      return await this.postgresRepo.logAttempt(log)
    } catch (error) {
      logFallback('Postgres webhook delivery log failed', error)
      const fullLog: WebhookDeliveryLog = {
        ...log,
        id: randomUUID(),
        attemptedAt: new Date(),
      }
      const list = fallbackDeliveryLogs.get(log.subscriptionId) || []
      list.push(fullLog)
      fallbackDeliveryLogs.set(log.subscriptionId, list)
      return fullLog
    }
  }

  async getHistoryBySubscription(subscriptionId: string): Promise<WebhookDeliveryLog[]> {
    try {
      return await this.postgresRepo.getHistoryBySubscription(subscriptionId)
    } catch (error) {
      logFallback('Postgres webhook delivery history failed', error)
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
      const list = fallbackDeliveryLogs.get(subscriptionId) || []
      return list.filter(l => l.attemptedAt.getTime() > thirtyDaysAgo)
    }
  }
}

export const webhookSubscriptionStore = new WebhookSubscriptionStore()
export const webhookDeliveryStore = new WebhookDeliveryStore()
