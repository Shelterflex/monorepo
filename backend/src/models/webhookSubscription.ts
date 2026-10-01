import { randomUUID } from 'node:crypto'
import {
  PostgresWebhookSubscriptionRepository,
  PostgresWebhookDeliveryLogRepository,
} from '../repositories/WebhookRepository.js'

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
      console.warn('Postgres webhook subscription creation failed, using fallback cache:', error)
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
      console.warn('Postgres webhook subscription lookup failed, using fallback cache:', error)
      return fallbackSubscriptions.get(id)
    }
  }

  async listByOwner(ownerId: string): Promise<WebhookSubscription[]> {
    try {
      return await this.postgresRepo.listByOwner(ownerId)
    } catch (error) {
      console.warn('Postgres webhook subscription list by owner failed, using fallback cache:', error)
      return Array.from(fallbackSubscriptions.values()).filter(s => s.ownerId === ownerId)
    }
  }

  async listActiveByEvent(event: WebhookEventType): Promise<WebhookSubscription[]> {
    try {
      return await this.postgresRepo.listActiveByEvent(event)
    } catch (error) {
      console.warn('Postgres webhook subscription list by event failed, using fallback cache:', error)
      return Array.from(fallbackSubscriptions.values()).filter(s => s.active && s.events.includes(event))
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      return await this.postgresRepo.delete(id)
    } catch (error) {
      console.warn('Postgres webhook subscription delete failed, using fallback cache:', error)
      return fallbackSubscriptions.delete(id)
    }
  }

  async updateActive(id: string, active: boolean): Promise<void> {
    try {
      await this.postgresRepo.updateActive(id, active)
    } catch (error) {
      console.warn('Postgres webhook subscription update failed, using fallback cache:', error)
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
      console.warn('Postgres webhook delivery log failed, using fallback cache:', error)
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
      console.warn('Postgres webhook delivery history failed, using fallback cache:', error)
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
      const list = fallbackDeliveryLogs.get(subscriptionId) || []
      return list.filter(l => l.attemptedAt.getTime() > thirtyDaysAgo)
    }
  }
}

export const webhookSubscriptionStore = new WebhookSubscriptionStore()
export const webhookDeliveryStore = new WebhookDeliveryStore()
