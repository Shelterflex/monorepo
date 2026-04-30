import { Redis } from 'ioredis'
import { getRedisClient } from '../utils/redis.js'
import { logger } from '../utils/logger.js'
import { meter } from '../utils/metrics.js'

export interface BurstRateLimitResult {
  allowed: boolean
  remaining: number
  total: number
  reset: number
  burstRemaining: number
  burstTotal: number
  usingBurst: boolean
}

export interface BurstRateLimitConfig {
  /** Base rate limit per window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Burst allowance (additional requests allowed temporarily) */
  burstLimit: number
  /** Burst window duration in milliseconds (shorter than main window) */
  burstWindowMs: number
}

export class BurstRateLimiter {
  private readonly redis: Redis

  constructor() {
    this.redis = getRedisClient()
  }

  /**
   * Check if a request is allowed with burst allowance.
   * Uses a two-tier sliding window: main quota + burst allowance.
   */
  async checkLimit(
    key: string,
    config: BurstRateLimitConfig
  ): Promise<BurstRateLimitResult> {
    const now = Date.now()
    const mainWindowStart = now - config.windowMs
    const burstWindowStart = now - config.burstWindowMs

    // Lua script for atomic burst rate limiting
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local mainWindowStart = tonumber(ARGV[2])
      local burstWindowStart = tonumber(ARGV[3])
      local limit = tonumber(ARGV[4])
      local windowMs = tonumber(ARGV[5])
      local burstLimit = tonumber(ARGV[6])
      local burstWindowMs = tonumber(ARGV[7])

      -- Main window key
      local mainKey = key .. ":main"
      -- Burst window key
      local burstKey = key .. ":burst"

      -- Clean up old entries from main window
      redis.call('ZREMRANGEBYSCORE', mainKey, 0, mainWindowStart)
      -- Clean up old entries from burst window
      redis.call('ZREMRANGEBYSCORE', burstKey, 0, burstWindowStart)

      -- Get current counts
      local mainCount = redis.call('ZCARD', mainKey)
      local burstCount = redis.call('ZCARD', burstKey)

      -- Check if we can use main quota
      local allowed = false
      local usingBurst = false
      local totalRemaining = 0
      local burstRemaining = burstLimit - burstCount

      if mainCount < limit then
        -- Use main quota
        redis.call('ZADD', mainKey, now, now .. ":" .. math.random())
        allowed = true
        totalRemaining = limit - mainCount - 1
      elseif burstCount < burstLimit then
        -- Use burst allowance
        redis.call('ZADD', burstKey, now, now .. ":" .. math.random())
        allowed = true
        usingBurst = true
        totalRemaining = 0
        burstRemaining = burstLimit - burstCount - 1
      end

      -- Set expiry
      redis.call('PEXPIRE', mainKey, windowMs)
      redis.call('PEXPIRE', burstKey, burstWindowMs)

      return { allowed and 1 or 0, totalRemaining, limit, math.floor(now + windowMs), burstRemaining, burstLimit, usingBurst and 1 or 0 }
    `

    try {
      const [allowed, remaining, total, reset, burstRemaining, burstTotal, usingBurst] =
        (await this.redis.eval(
          luaScript,
          1,
          key,
          now.toString(),
          mainWindowStart.toString(),
          burstWindowStart.toString(),
          config.limit.toString(),
          config.windowMs.toString(),
          config.burstLimit.toString(),
          config.burstWindowMs.toString()
        )) as [number, number, number, number, number, number, number]

      // Record metrics
      if (allowed === 1) {
        meter
          .createCounter('rate_limit_allowed_total', {
            description: 'Total number of requests allowed by rate limiter',
          })
          .add(1, { using_burst: usingBurst === 1 ? 'true' : 'false' })
      } else {
        meter
          .createCounter('rate_limit_denied_total', {
            description: 'Total number of requests denied by rate limiter',
          })
          .add(1, { reason: 'quota_exceeded' })
      }

      return {
        allowed: allowed === 1,
        remaining: Math.max(0, remaining),
        total,
        reset,
        burstRemaining: Math.max(0, burstRemaining),
        burstTotal,
        usingBurst: usingBurst === 1,
      }
    } catch (error) {
      logger.error('Burst rate limiter error', { key, error })
      // On error, allow the request to avoid blocking users
      return {
        allowed: true,
        remaining: config.limit,
        total: config.limit,
        reset: now + config.windowMs,
        burstRemaining: config.burstLimit,
        burstTotal: config.burstLimit,
        usingBurst: false,
      }
    }
  }

  /**
   * Get current quota state for a key
   */
  async getQuotaState(key: string): Promise<{
    mainCount: number
    burstCount: number
    mainReset: number
    burstReset: number
  }> {
    const now = Date.now()
    const mainKey = `${key}:main`
    const burstKey = `${key}:burst`

    try {
      const mainCount = (await this.redis.zcard(mainKey)) || 0
      const burstCount = (await this.redis.zcard(burstKey)) || 0
      const mainTtl = (await this.redis.pttl(mainKey)) || 0
      const burstTtl = (await this.redis.pttl(burstKey)) || 0

      return {
        mainCount,
        burstCount,
        mainReset: mainTtl > 0 ? now + mainTtl : now,
        burstReset: burstTtl > 0 ? now + burstTtl : now,
      }
    } catch (error) {
      logger.error('Error getting quota state', { key, error })
      return {
        mainCount: 0,
        burstCount: 0,
        mainReset: now,
        burstReset: now,
      }
    }
  }

  /**
   * Reset quota for a key (admin function)
   */
  async resetQuota(key: string): Promise<void> {
    try {
      await this.redis.del(`${key}:main`, `${key}:burst`)
      logger.info('Quota reset', { key })
    } catch (error) {
      logger.error('Error resetting quota', { key, error })
      throw error
    }
  }
}

export const burstRateLimiter = new BurstRateLimiter()
