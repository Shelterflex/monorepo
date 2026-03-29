import { PostgresUserRepository } from './repositories/AuthRepository.js'
import { MultiLayerCache, MemoryCacheLayer, CacheLayer } from './utils/cache.js'

// Mock Redis Layer to avoid connection errors
class MockRedisCacheLayer<T> implements CacheLayer<T> {
    private storage = new Map<string, string>()
    async get(key: string): Promise<T | null> {
        const val = this.storage.get(key)
        return val ? JSON.parse(val) : null
    }
    async set(key: string, value: T): Promise<void> {
        this.storage.set(key, JSON.stringify(value))
    }
    async delete(key: string): Promise<void> {
        this.storage.delete(key)
    }
    async clear(): Promise<void> {
        this.storage.clear()
    }
}

/**
 * Benchmark script with mocked infrastructure.
 */
async function runBenchmark() {
    console.log('\n--- Caching Benchmark (Isolated Verification) ---')

    const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'tenant',
        createdAt: new Date(),
        tier: 'free',
        planQuota: 100
    }

    // Create a local MultiLayerCache for testing logic
    const testCache = new MultiLayerCache<any>(
        new MemoryCacheLayer({ max: 100, ttlMs: 60000 }),
        new MockRedisCacheLayer() as any,
        60000
    )

    const email = 'test@example.com'
    const key = `email:${email}`

    // 1. Cold start (Simulated DB fetch + Cache Write)
    console.log('1. Cold Start (Initial Fetch)...')
    const start1 = performance.now()
    await testCache.set(key, mockUser)
    const end1 = performance.now()
    console.log(`   Time to set L1+L2: ${(end1 - start1).toFixed(4)}ms`)

    // 2. Warm start (L1 Cache Hit)
    console.log('2. L1 Cache Hit...')
    const start2 = performance.now()
    const res2 = await testCache.get(key)
    const end2 = performance.now()
    console.log(`   Time: ${(end2 - start2).toFixed(4)}ms`)
    console.log('   Result:', res2 ? 'HIT' : 'MISS')

    // 3. L2 Cache Hit (after L1 clear)
    console.log('3. L2 Cache Hit (L1 Clear)...')
    await (testCache as any).l1.clear()
    const start3 = performance.now()
    const res3 = await testCache.get(key)
    const end3 = performance.now()
    console.log(`   Time: ${(end3 - start3).toFixed(4)}ms`)
    console.log('   Result:', res3 ? 'HIT' : 'MISS')

    // Verify L1 was backfilled
    const res4 = await (testCache as any).l1.get(key)
    console.log('   L1 Backfilled:', res4 ? 'YES' : 'NO')

    console.log('\nFinal Metrics:', testCache.getMetrics())
}

runBenchmark().catch(console.error)
