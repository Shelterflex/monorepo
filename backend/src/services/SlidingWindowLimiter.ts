import { Redis } from 'ioredis'
import { getRedisClient } from '../utils/redis.js'

export interface RateLimitResult {
    allowed: boolean
    remaining: number
    total: number
    reset: number
}

export class SlidingWindowLimiter {
    private redis: Redis

    constructor() {
        this.redis = getRedisClient()
    }

    /**
     * Check if a request is allowed within the sliding window.
     * LUA script ensures atomicity.
     */
    async checkLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
        const now = Date.now()
        const windowStart = now - windowMs

        // Lua script logic:
        // 1. Remove old timestamps from the sorted set
        // 2. Add current timestamp to the sorted set
        // 3. Count total items in the sorted set
        // 4. Set expiration on the key for cleanup
        const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local windowMs = tonumber(ARGV[4])

      -- Remove elements older than the window
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
      
      -- Get current count
      local currentCount = redis.call('ZCARD', key)
      
      local allowed = currentCount < limit
      if allowed then
        -- Add current timestamp
        redis.call('ZADD', key, now, now .. ":" .. math.random())
        currentCount = currentCount + 1
      end
      
      -- Set expiry to window duration to ensure cleanup if idle
      redis.call('PEXPIRE', key, windowMs)
      
      return { allowed and 1 or 0, limit - currentCount, limit, math.floor(now + windowMs) }
    `

        const [allowed, remaining, total, reset] = (await this.redis.eval(
            luaScript,
            1,
            key,
            now.toString(),
            windowStart.toString(),
            limit.toString(),
            windowMs.toString()
        )) as [number, number, number, number]

        return {
            allowed: allowed === 1,
            remaining: Math.max(0, remaining),
            total,
            reset
        }
    }
}

export const slidingWindowLimiter = new SlidingWindowLimiter()
