import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import request from 'supertest'
import { createSorobanAdapter } from '../soroban/index.js'

vi.mock('../soroban/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../soroban/index.js')>()
  return {
    ...actual,
    createSorobanAdapter: vi.fn(),
  }
})

describe('Staking Position (Real Adapter)', () => {
  let app: any
  let authToken: string
  let adapterMock: {
    getStakedBalance: ReturnType<typeof vi.fn>
    getClaimableRewards: ReturnType<typeof vi.fn>
    getReceiptEvents: ReturnType<typeof vi.fn>
    getConfig: ReturnType<typeof vi.fn>
  }
  const email = 'real-staking-test@example.com'
  const walletAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.SOROBAN_ADAPTER_MODE = 'real'
    adapterMock = {
      getStakedBalance: vi.fn(),
      getClaimableRewards: vi.fn(),
      getReceiptEvents: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockReturnValue({}),
    }
    vi.mocked(createSorobanAdapter).mockReturnValue(adapterMock as any)
    app = createApp()

    await userStore.getOrCreateByEmail(email)
    authToken = 'test-token-real-position'
    await sessionStore.create(email, authToken)
  })

  it('should return real staking position using on-chain adapter', async () => {
    adapterMock.getStakedBalance.mockResolvedValue(123000000n)
    adapterMock.getClaimableRewards.mockResolvedValue(4560000n)

    const response = await request(app)
      .get('/api/staking/position')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-wallet-address', walletAddress)
      .expect(200)

    expect(response.body.success).toBe(true)
    expect(response.body.position.staked).toBe('123.000000')
    expect(response.body.position.claimable).toBe('4.560000')
    
    expect(adapterMock.getStakedBalance).toHaveBeenCalledWith(walletAddress)
    expect(adapterMock.getClaimableRewards).toHaveBeenCalledWith(walletAddress)
  })

  it('should return 500 when adapter fails', async () => {
    adapterMock.getStakedBalance.mockRejectedValue(new Error('Chain error'))
    adapterMock.getClaimableRewards.mockResolvedValue(0n)

    const response = await request(app)
      .get('/api/staking/position')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-wallet-address', walletAddress)
      .expect(500)

    expect(response.body.error).toBeDefined()
    expect(response.body.error.message).toBe('Chain error')
  })
})
