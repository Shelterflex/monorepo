import { Redis } from 'ioredis'
import { EventEmitter } from 'node:events'
import { env } from '../schemas/env.js'

let redis: Redis | null = null

// Simple mock for environments without Redis (e.g. CI/Tests)
class MockRedis extends EventEmitter {
    private readonly storage = new Map<string, string>()
    constructor() {
        super()
    }
    async get(key: string) { return this.storage.get(key) || null }
    async set(key: string, value: string, mode?: string, duration?: number) {
        this.storage.set(key, value)
        return 'OK'
    }
    async del(key: string) { return this.storage.delete(key) ? 1 : 0 }
    async quit() { return 'OK' }
    async keys(pattern: string) {
        const regex = new RegExp('^' + pattern.replaceAll('*', '.*') + '$')
        return Array.from(this.storage.keys()).filter(k => regex.test(k))
    }
}

export function getRedisClient(): Redis {
    if (redis) return redis

    // In test environment or if REDIS_DISABLED is set, use mock
    if (process.env.NODE_ENV === 'test' || process.env.REDIS_DISABLED === 'true') {
        console.log('[redis] using mock client (test/disabled mode)')
        redis = new MockRedis() as any
        return redis!
    }

    redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000)
            return delay
        },
    })

    redis.on('error', (err) => {
        console.error('[redis] unexpected error:', err)
    })

    redis.on('connect', () => {
        console.log('[redis] connected to', env.REDIS_URL)
    })
    return redis
}

export async function closeRedis() {
    if (redis) {
        await redis.quit()
        redis = null
    }
}
