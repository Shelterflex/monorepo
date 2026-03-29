import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SlidingWindowLimiter } from './SlidingWindowLimiter.js'
import { getRedisClient } from '../utils/redis.js'

// Mock redis
vi.mock('../utils/redis.js', () => ({
    getRedisClient: vi.fn(),
}))

describe('SlidingWindowLimiter', () => {
    let limiter: SlidingWindowLimiter
    let mockRedis: any

    beforeEach(() => {
        vi.clearAllMocks()
        mockRedis = {
            eval: vi.fn(),
        }
            ; (getRedisClient as any).mockReturnValue(mockRedis)
        limiter = new SlidingWindowLimiter()
    })

    it('should allow request when under limit', async () => {
        mockRedis.eval.mockResolvedValue([1, 9, 10, Date.now() + 60000])

        const result = await limiter.checkLimit('test-key', 10, 60000)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(9)
        expect(result.total).toBe(10)
    })

    it('should block request when over limit', async () => {
        mockRedis.eval.mockResolvedValue([0, 0, 10, Date.now() + 60000])

        const result = await limiter.checkLimit('test-key', 10, 60000)

        expect(result.allowed).toBe(false)
        expect(result.remaining).toBe(0)
    })

    it('should handle zero remaining correctly', async () => {
        mockRedis.eval.mockResolvedValue([1, 0, 10, Date.now() + 60000])

        const result = await limiter.checkLimit('test-key', 10, 60000)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(0)
    })
})
