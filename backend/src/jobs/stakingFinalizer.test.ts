import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StakingFinalizer } from './stakingFinalizer.js'
import { StakingService } from '../services/stakingService.js'
import { conversionStore } from '../models/conversionStore.js'
import { outboxStore } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'

describe('StakingFinalizer', () => {
  let finalizer: StakingFinalizer
  let stakingService: StakingService
  let adapter: SorobanAdapter

  beforeEach(async () => {
    await conversionStore.clear()
    await outboxStore.clear()
    
    // Mock adapter
    adapter = {
      recordReceipt: vi.fn().mockResolvedValue({}),
    } as any

    stakingService = new StakingService(adapter)
    finalizer = new StakingFinalizer(stakingService, 100) // Short interval for testing
  })

  it('automatically finalizes completed conversions', async () => {
    // 1. Create a completed conversion
    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_001',
      userId: 'user_1',
      amountNgn: 1600,
      provider: 'onramp',
    })
    await conversionStore.markCompleted(conversion.conversionId, {
      amountUsdc: '1.000000',
      fxRateNgnPerUsdc: 1600,
      providerRef: 'ref_001',
    })

    // 2. Run poll manually
    await finalizer.poll()

    // 3. Verify outbox item was created
    const outboxItems = await outboxStore.listAll()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].txType).toBe('stake')
    expect(outboxItems[0].payload.conversionId).toBe(conversion.conversionId)
  })

  it('handles multiple completed conversions', async () => {
    const c1 = await conversionStore.createPending({ depositId: 'd1', userId: 'u1', amountNgn: 100, provider: 'onramp' })
    const c2 = await conversionStore.createPending({ depositId: 'd2', userId: 'u1', amountNgn: 200, provider: 'onramp' })
    
    await conversionStore.markCompleted(c1.conversionId, { amountUsdc: '1', fxRateNgnPerUsdc: 100, providerRef: 'r1' })
    await conversionStore.markCompleted(c2.conversionId, { amountUsdc: '2', fxRateNgnPerUsdc: 100, providerRef: 'r2' })

    await finalizer.poll()

    const outboxItems = await outboxStore.listAll()
    expect(outboxItems).toHaveLength(2)
  })
})
