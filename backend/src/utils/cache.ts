import { LRUCache } from 'lru-cache'
import { getRedisClient } from './redis.js'
import { logger } from './logger.js'

export interface CacheLayer<T> {
    get(key: string): Promise<T | null>
    set(key: string, value: T, ttlMs?: number): Promise<void>
    delete(key: string): Promise<void>
    clear(): Promise<void>
}

export class MemoryCacheLayer<T extends {}> implements CacheLayer<T> {
    private cache: LRUCache<string, T>

    constructor(options: { max: number; ttlMs: number }) {
        this.cache = new LRUCache<string, T>({
            max: options.max,
            ttl: options.ttlMs,
        })
    }

    async get(key: string): Promise<T | null> {
        return this.cache.get(key) ?? null
    }

    async set(key: string, value: T, ttlMs?: number): Promise<void> {
        this.cache.set(key, value, { ttl: ttlMs })
    }

    async delete(key: string): Promise<void> {
        this.cache.delete(key)
    }

    async clear(): Promise<void> {
        this.cache.clear()
    }
}

export class RedisCacheLayer<T> implements CacheLayer<T> {
    constructor(private prefix: string) { }

    private get fullPrefix() {
        return `cache:${this.prefix}:`
    }

    async get(key: string): Promise<T | null> {
        const redis = getRedisClient()
        const data = await redis.get(this.fullPrefix + key)
        if (!data) return null
        try {
            return JSON.parse(data) as T
        } catch (err) {
            logger.error(`[RedisCache] parse error for key ${key}:`, {}, err)
            return null
        }
    }

    async set(key: string, value: T, ttlMs?: number): Promise<void> {
        const redis = getRedisClient()
        const data = JSON.stringify(value)
        if (ttlMs) {
            await redis.set(this.fullPrefix + key, data, 'PX', ttlMs)
        } else {
            await redis.set(this.fullPrefix + key, data)
        }
    }

    async delete(key: string): Promise<void> {
        const redis = getRedisClient()
        await redis.del(this.fullPrefix + key)
    }

    async clear(): Promise<void> {
        const redis = getRedisClient()
        const keys = await redis.keys(this.fullPrefix + '*')
        if (keys.length > 0) {
            await redis.del(...keys)
        }
    }
}

export interface CacheMetrics {
    hits: number
    misses: number
    l1Hits: number
    l2Hits: number
}

export class MultiLayerCache<T extends {}> {
    private metrics: CacheMetrics = { hits: 0, misses: 0, l1Hits: 0, l2Hits: 0 }

    constructor(
        private l1: MemoryCacheLayer<T>,
        private l2: RedisCacheLayer<T>,
        private defaultTtlMs: number = 60000
    ) { }

    async get(key: string): Promise<T | null> {
        // 1. Try L1
        const l1Value = await this.l1.get(key)
        if (l1Value !== null) {
            this.metrics.hits++
            this.metrics.l1Hits++
            return l1Value
        }

        // 2. Try L2 with fallback
        try {
            const l2Value = await this.l2.get(key)
            if (l2Value !== null) {
                this.metrics.hits++
                this.metrics.l2Hits++
                // Backfill L1
                await this.l1.set(key, l2Value, this.defaultTtlMs)
                return l2Value
            }
        } catch (err) {
            logger.warn('L2 cache get error (falling back to miss)', { key, error: err instanceof Error ? err.message : String(err) })
        }

        this.metrics.misses++
        return null
    }

    async set(key: string, value: T, ttlMs?: number): Promise<void> {
        const ttl = ttlMs ?? this.defaultTtlMs
        const promises: Promise<any>[] = [this.l1.set(key, value, ttl)]

        // Attempt L2 set but don't fail if it crashes
        promises.push(
            this.l2.set(key, value, ttl).catch(err => {
                logger.warn('L2 cache set error', { key, error: err instanceof Error ? err.message : String(err) })
            })
        )

        await Promise.all(promises)
    }

    async warm(items: { key: string; value: T }[]): Promise<void> {
        const promises = items.map(item => this.set(item.key, item.value))
        await Promise.all(promises)
    }

    async invalidate(key: string): Promise<void> {
        await Promise.all([this.l1.delete(key), this.l2.delete(key)])
    }

    async clear(): Promise<void> {
        await Promise.all([this.l1.clear(), this.l2.clear()])
    }

    getMetrics(): CacheMetrics & { hitRate: number } {
        const total = this.metrics.hits + this.metrics.misses
        const hitRate = total === 0 ? 0 : this.metrics.hits / total
        return { ...this.metrics, hitRate }
    }
}

// Singletons for common entities
export const userCache = new MultiLayerCache<any>(
    new MemoryCacheLayer({ max: 1000, ttlMs: 300000 }), // 5 min
    new RedisCacheLayer('user'),
    300000
)

export const conversionCache = new MultiLayerCache<any>(
    new MemoryCacheLayer({ max: 500, ttlMs: 60000 }), // 1 min
    new RedisCacheLayer('conversion'),
    60000
)

export async function getCacheStats() {
    return {
        user: userCache.getMetrics(),
        conversion: conversionCache.getMetrics()
    }
}
