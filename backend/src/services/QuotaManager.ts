import { Redis } from 'ioredis'
import { getRedisClient } from '../utils/redis.js'
import { logger } from '../utils/logger.js'
import { meter } from '../utils/metrics.js'
import type { User } from '../repositories/AuthRepository.js'
import { UserTier, TierLimits, quotaService } from './QuotaService.js'

export interface QuotaOverride {
  userId: string
  endpoint?: string
  elevatedLimit: number
  reason: string
  createdBy: string
  createdAt: number
  expiresAt?: number
}

export interface QuotaUsage {
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

export class QuotaManager {
  private redis: Redis
  private overrideCache: Map<string, QuotaOverride> = new Map()
  private readonly OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

  constructor() {
    this.redis = getRedisClient()
  }

  /**
   * Check if a user has an active quota override
   */
  async getOverride(userId: string, endpoint?: string): Promise<QuotaOverride | null> {
    const cacheKey = `${userId}:${endpoint || 'all'}`

    // Check cache first
    const cached = this.overrideCache.get(cacheKey)
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
      return cached
    }

    try {
      const data = await this.redis.get(`quota:override:${cacheKey}`)
      if (data) {
        const override: QuotaOverride = JSON.parse(data)
        if (!override.expiresAt || override.expiresAt > Date.now()) {
          this.overrideCache.set(cacheKey, override)
          return override
        }
      }
    } catch (error) {
      logger.error('Error getting quota override', { userId, endpoint, error })
    }

    return null
  }

  /**
   * Set a quota override for a user (admin function)
   */
  async setOverride(override: QuotaOverride): Promise<void> {
    const cacheKey = `${override.userId}:${override.endpoint || 'all'}`

    try {
      await this.redis.setex(
        `quota:override:${cacheKey}`,
        Math.floor(this.OVERRIDE_TTL_MS / 1000),
        JSON.stringify(override)
      )
      this.overrideCache.set(cacheKey, override)

      // Log admin action
      logger.warn('Quota override created', {
        userId: override.userId,
        endpoint: override.endpoint,
        elevatedLimit: override.elevatedLimit,
        reason: override.reason,
        createdBy: override.createdBy,
      })

      // Record metric
      meter
        .createCounter('quota_override_created_total', {
          description: 'Total number of quota overrides created',
        })
        .add(1, { user_id: override.userId })
    } catch (error) {
      logger.error('Error setting quota override', { override, error })
      throw error
    }
  }

  /**
   * Remove a quota override (admin function)
   */
  async removeOverride(userId: string, endpoint?: string): Promise<void> {
    const cacheKey = `${userId}:${endpoint || 'all'}`

    try {
      await this.redis.del(`quota:override:${cacheKey}`)
      this.overrideCache.delete(cacheKey)

      logger.info('Quota override removed', { userId, endpoint })
    } catch (error) {
      logger.error('Error removing quota override', { userId, endpoint, error })
      throw error
    }
  }

  /**
   * Get quota usage for a user and endpoint
   */
  async getQuotaUsage(userId: string, endpoint: string): Promise<QuotaUsage> {
    const now = Date.now()
    const minuteKey = `quota:usage:${userId}:${endpoint}:minute`
    const dayKey = `quota:usage:${userId}:${endpoint}:day`

    try {
      const minuteCount = (await this.redis.zcard(minuteKey)) || 0
      const dayCount = (await this.redis.zcard(dayKey)) || 0
      const minuteTtl = (await this.redis.pttl(minuteKey)) || 0
      const dayTtl = (await this.redis.pttl(dayKey)) || 0

      const limits = await quotaService.getUserLimits()
      const override = await this.getOverride(userId, endpoint)
      const effectiveLimit = override?.elevatedLimit ?? limits.requestsPerMinute

      const nearLimit = minuteCount >= effectiveLimit * 0.8

      // Record near-limit metric
      if (nearLimit) {
        meter
          .createCounter('quota_near_limit_total', {
            description: 'Total number of times quota is near limit',
          })
          .add(1, { user_id: userId, endpoint })
      }

      return {
        userId,
        endpoint,
        minuteUsage: minuteCount,
        dayUsage: dayCount,
        minuteLimit: effectiveLimit,
        dayLimit: limits.requestsPerDay,
        minuteReset: minuteTtl > 0 ? now + minuteTtl : now + 60000,
        dayReset: dayTtl > 0 ? now + dayTtl : now + 86400000,
        nearLimit,
      }
    } catch (error) {
      logger.error('Error getting quota usage', { userId, endpoint, error })
      throw error
    }
  }

  /**
   * Track quota usage for a request
   */
  async trackUsage(userId: string, endpoint: string): Promise<void> {
    const now = Date.now()
    const minuteWindowStart = now - 60000 // 1 minute
    const dayWindowStart = now - 86400000 // 24 hours

    const minuteKey = `quota:usage:${userId}:${endpoint}:minute`
    const dayKey = `quota:usage:${userId}:${endpoint}:day`

    try {
      const pipeline = this.redis.pipeline()

      // Clean up old entries and add new one for minute window
      pipeline.zremrangebyscore(minuteKey, 0, minuteWindowStart)
      pipeline.zadd(minuteKey, now, `${now}:${Math.random()}`)
      pipeline.expire(minuteKey, 120) // 2 minutes to allow for clock skew

      // Clean up old entries and add new one for day window
      pipeline.zremrangebyscore(dayKey, 0, dayWindowStart)
      pipeline.zadd(dayKey, now, `${now}:${Math.random()}`)
      pipeline.expire(dayKey, 90000) // 25 hours to allow for clock skew

      await pipeline.exec()
    } catch (error) {
      logger.error('Error tracking quota usage', { userId, endpoint, error })
      // Don't throw - tracking failures shouldn't block requests
    }
  }

  /**
   * Get all active overrides for a user
   */
  async getUserOverrides(userId: string): Promise<QuotaOverride[]> {
    const pattern = `quota:override:${userId}:*`
    const overrides: QuotaOverride[] = []

    try {
      const keys = await this.redis.keys(pattern)
      for (const key of keys) {
        const data = await this.redis.get(key)
        if (data) {
          const override: QuotaOverride = JSON.parse(data)
          if (!override.expiresAt || override.expiresAt > Date.now()) {
            overrides.push(override)
          }
        }
      }
    } catch (error) {
      logger.error('Error getting user overrides', { userId, error })
    }

    return overrides
  }

  /**
   * Get quota statistics across all users
   */
  async getQuotaStats(): Promise<{
    totalOverrides: number
    activeOverrides: number
    nearLimitUsers: number
  }> {
    try {
      const pattern = 'quota:override:*'
      const keys = await this.redis.keys(pattern)
      let activeCount = 0

      for (const key of keys) {
        const data = await this.redis.get(key)
        if (data) {
          const override: QuotaOverride = JSON.parse(data)
          if (!override.expiresAt || override.expiresAt > Date.now()) {
            activeCount++
          }
        }
      }

      // Get near-limit count (simplified - in production would use a more efficient approach)
      const nearLimitCount = await this.getNearLimitCount()

      return {
        totalOverrides: keys.length,
        activeOverrides: activeCount,
        nearLimitUsers: nearLimitCount,
      }
    } catch (error) {
      logger.error('Error getting quota stats', { error })
      return {
        totalOverrides: 0,
        activeOverrides: 0,
        nearLimitUsers: 0,
      }
    }
  }

  private async getNearLimitCount(): Promise<number> {
    // This is a simplified version - in production would use a more efficient approach
    // like maintaining a separate sorted set of users near their limits
    return 0
  }
}

export const quotaManager = new QuotaManager()
