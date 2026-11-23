import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import request from 'supertest'
import { RealSorobanAdapter } from '../soroban/real-adapter.js'

// Correct class mocking for Vitest
vi.mock('../soroban/real-adapter.js', () => {
  const RealSorobanAdapter = vi.fn()
  RealSorobanAdapter.prototype.getStakedBalance = vi.fn()
  RealSorobanAdapter.prototype.getClaimableRewards = vi.fn()
  RealSorobanAdapter.prototype.mvpStakedBalance = vi.fn()
  RealSorobanAdapter.prototype.usedStake = vi.fn()
  RealSorobanAdapter.prototype.unusedStake = vi.fn()
  RealSorobanAdapter.prototype.claimable = vi.fn()
  RealSorobanAdapter.prototype.getReceiptEvents = vi.fn().mockResolvedValue([])
  RealSorobanAdapter.prototype.getConfig = vi.fn().mockReturnValue({})
  return { RealSorobanAdapter }
})

describe('Staking Position (Real Adapter)', () => {
  let app: any
  let authToken: string
  const email = 'real-staking-test@example.com'
  const walletAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

  beforeEach(async () => {
    process.env.USE_REAL_SOROBAN = 'true'
    app = createApp()
    vi.clearAllMocks()

    userStore.getOrCreateByEmail(email)
    authToken = 'test-token-real-position'
    sessionStore.create(email, authToken)
  })

  afterEach(() => {
    delete process.env.USE_REAL_SOROBAN
  })

  it('should return real staking position using on-chain adapter', async () => {
    const getStakedSpy = vi.spyOn(RealSorobanAdapter.prototype, 'getStakedBalance').mockResolvedValue(123000000n)
    const getClaimableSpy = vi.spyOn(RealSorobanAdapter.prototype, 'getClaimableRewards').mockResolvedValue(4560000n)

    const response = await request(app)
      .get('/api/staking/position')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-wallet-address', walletAddress)
      .expect(200)

    expect(response.body.success).toBe(true)
    expect(response.body.position.staked).toBe('123.000000')
    expect(response.body.position.claimable).toBe('4.560000')
    
    expect(getStakedSpy).toHaveBeenCalledWith(walletAddress)
    expect(getClaimableSpy).toHaveBeenCalledWith(walletAddress)
  })

  it('should return 500 when adapter fails', async () => {
    vi.spyOn(RealSorobanAdapter.prototype, 'getStakedBalance').mockRejectedValue(new Error('Chain error'))
    vi.spyOn(RealSorobanAdapter.prototype, 'getClaimableRewards').mockResolvedValue(0n)

    const response = await request(app)
      .get('/api/staking/position')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-wallet-address', walletAddress)
      .expect(500)

    expect(response.body.error).toBeDefined()
    expect(response.body.error.message).toBe('Chain error')
  })

  it('should return the MVP used and unused stake split', async () => {
    vi.spyOn(RealSorobanAdapter.prototype, 'mvpStakedBalance').mockResolvedValue(123000000n)
    vi.spyOn(RealSorobanAdapter.prototype, 'usedStake').mockResolvedValue(23000000n)
    vi.spyOn(RealSorobanAdapter.prototype, 'unusedStake').mockResolvedValue(100000000n)
    vi.spyOn(RealSorobanAdapter.prototype, 'claimable').mockResolvedValue(4560000n)

    const response = await request(app)
      .get('/api/staking/mvp-position')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-wallet-address', walletAddress)
      .expect(200)

    expect(response.body.position).toEqual({
      staked: '123.000000',
      used: '23.000000',
      unused: '100.000000',
      claimable: '4.560000',
    })
  })

  it('should return 503 when MVP staking contract is unavailable', async () => {
    vi.spyOn(RealSorobanAdapter.prototype, 'mvpStakedBalance').mockImplementation(undefined as any)

    const response = await request(app)
      .get('/api/staking/mvp-position')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-wallet-address', walletAddress)
      .expect(503)

    expect(response.body.error).toBeDefined()
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE')
  })
})
