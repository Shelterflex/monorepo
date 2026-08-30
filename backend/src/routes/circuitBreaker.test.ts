import request from 'supertest'
import express from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { createCircuitBreakerRouter } from './circuitBreaker.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the env module
vi.mock('../schemas/env.js', () => ({
  env: {
    MANUAL_ADMIN_SECRET: 'test-secret',
  },
}))

class MockSorobanAdapter implements SorobanAdapter {
  getBalance = vi.fn().mockResolvedValue(BigInt(1000000))
  credit = vi.fn().mockResolvedValue(undefined)
  debit = vi.fn().mockResolvedValue(undefined)
  getStakedBalance = vi.fn().mockResolvedValue(BigInt(500000))
  getClaimableRewards = vi.fn().mockResolvedValue(BigInt(10000))
  recordReceipt = vi.fn().mockResolvedValue(undefined)
  getConfig = vi.fn().mockReturnValue({})
  getReceiptEvents = vi.fn().mockResolvedValue([])
  getTimelockEvents = vi.fn().mockResolvedValue([])
  executeTimelock = vi.fn().mockResolvedValue('')
  cancelTimelock = vi.fn().mockResolvedValue('')
  stakeBond = vi.fn().mockResolvedValue(undefined)
  unstakeBond = vi.fn().mockResolvedValue(undefined)
  isBonded = vi.fn().mockResolvedValue(false)
  getBond = vi.fn().mockResolvedValue({ isBonded: false, amount: BigInt(0) })
  pause = vi.fn().mockResolvedValue('')
  unpause = vi.fn().mockResolvedValue('')
  setOperator = vi.fn().mockResolvedValue('')
  init = vi.fn().mockResolvedValue('')
  syncDealStatus = vi.fn().mockResolvedValue(undefined)
  addToAllowlist = vi.fn().mockResolvedValue('')
  removeFromAllowlist = vi.fn().mockResolvedValue('')
  isAllowlisted = vi.fn().mockResolvedValue(false)
  getAllowlistEntry = vi.fn().mockResolvedValue(null)
  updateTenantReputation = vi.fn().mockResolvedValue(undefined)
  getTenantReputation = vi.fn().mockResolvedValue(null)
  getTransactionStatus = vi.fn().mockResolvedValue({ status: 'success' })
  proposeAssignRole = vi.fn().mockResolvedValue('')
  confirmAssignRole = vi.fn().mockResolvedValue('')
  delegatePermission = vi.fn().mockResolvedValue('')
  getRole = vi.fn().mockResolvedValue(null)
  hasPermission = vi.fn().mockResolvedValue(false)
  listRoles = vi.fn().mockResolvedValue([])
  proposeUpgrade = vi.fn().mockResolvedValue('')
  confirmUpgrade = vi.fn().mockResolvedValue('')
  cancelUpgrade = vi.fn().mockResolvedValue('')
  transferAdmin = vi.fn().mockResolvedValue('')
  hasPendingUpgrade = vi.fn().mockResolvedValue(false)
  requestRentRelease = vi.fn().mockResolvedValue(undefined)
  challengeRentRelease = vi.fn().mockResolvedValue(undefined)
  resolveRentDispute = vi.fn().mockResolvedValue(undefined)
  settleRentReleaseTimeout = vi.fn().mockResolvedValue(undefined)
  settleDisputeTimeout = vi.fn().mockResolvedValue(undefined)
  registerRentToOwnDeal = vi.fn().mockResolvedValue(undefined)
  recordRentToOwnEquityPayment = vi.fn().mockResolvedValue(undefined)
  completeRentToOwnDeal = vi.fn().mockResolvedValue(undefined)
  defaultRentToOwnDeal = vi.fn().mockResolvedValue(undefined)
  delegateStake = vi.fn().mockResolvedValue('')
  requestUndelegate = vi.fn().mockResolvedValue('')
  completeUndelegate = vi.fn().mockResolvedValue('')
  claimDelegateeRewards = vi.fn().mockResolvedValue('')
  setDelegateeCommission = vi.fn().mockResolvedValue('')
  claimDelegateeCommission = vi.fn().mockResolvedValue('')
  getDelegations = vi.fn().mockResolvedValue([])
  getDelegationStakedBalance = vi.fn().mockResolvedValue(BigInt(0))
  getDelegationEpoch = vi.fn().mockResolvedValue(0)
  getDelegateeClaimable = vi.fn().mockResolvedValue(BigInt(0))
  getDelegateeCommissionClaimable = vi.fn().mockResolvedValue(BigInt(0))
  getOraclePrice = vi.fn().mockResolvedValue({ price: BigInt(100000000), decimals: 7, updatedAt: Date.now(), sequence: 1 })
  isOraclePriceStale = vi.fn().mockResolvedValue(false)
  epochStake = vi.fn().mockResolvedValue('')
  epochUnstake = vi.fn().mockResolvedValue('')
  epochClaim = vi.fn().mockResolvedValue(BigInt(0))
  epochGetClaimable = vi.fn().mockResolvedValue(BigInt(0))
  epochGetEpoch = vi.fn().mockResolvedValue(null)
  epochGetCurrentEpoch = vi.fn().mockResolvedValue(0)
  epochGetTotalStaked = vi.fn().mockResolvedValue(BigInt(0))
  epochFundRewards = vi.fn().mockResolvedValue('')
  epochSeal = vi.fn().mockResolvedValue('')
  rentWalletCredit = vi.fn().mockResolvedValue('')
  rentWalletDebit = vi.fn().mockResolvedValue('')
  rentWalletBalance = vi.fn().mockResolvedValue(BigInt(0))
  submitEvidence = vi.fn().mockResolvedValue(1)
  revealEvidence = vi.fn().mockResolvedValue(undefined)
  proposeSlash = vi.fn().mockResolvedValue(1)
  finalizeSlash = vi.fn().mockResolvedValue(undefined)
  cancelSlash = vi.fn().mockResolvedValue(undefined)
  depositBond = vi.fn().mockResolvedValue(undefined)
  withdrawBond = vi.fn().mockResolvedValue(undefined)
  getBondBalance = vi.fn().mockResolvedValue(BigInt(0))
  createProposal = vi.fn().mockResolvedValue({ xdr: 'test_xdr' })
  vote = vi.fn().mockResolvedValue({ xdr: 'test_xdr' })
  submitGovernanceTransaction = vi.fn().mockResolvedValue({ txHash: 'test_hash' })
  finalizeProposal = vi.fn().mockResolvedValue('')
  executeProposal = vi.fn().mockResolvedValue('')
  getProposal = vi.fn().mockResolvedValue(null)
  getProposalCount = vi.fn().mockResolvedValue(0)
  getReceiptById = vi.fn().mockResolvedValue(null)
  listReceiptsByDeal = vi.fn().mockResolvedValue([])
  listReceiptsByUser = vi.fn().mockResolvedValue([])
  createVestingSchedule = vi.fn().mockResolvedValue('test_tx_hash')
  revokeVesting = vi.fn().mockResolvedValue(BigInt(500000))
  claimVested = vi.fn().mockResolvedValue(BigInt(100000))
  getClaimableVested = vi.fn().mockResolvedValue(BigInt(100000))
  allocateReward = vi.fn().mockResolvedValue('test_tx_hash')
  claimReward = vi.fn().mockResolvedValue(BigInt(100000))
  getClaimableReward = vi.fn().mockResolvedValue(BigInt(100000))
  createRentPaymentReceipt = vi.fn().mockResolvedValue('test_tx_hash')
  listRentPaymentReceiptsByDeal = vi.fn().mockResolvedValue([])
  rentPaymentReceiptCount = vi.fn().mockResolvedValue(0)
  freeze = vi.fn().mockResolvedValue('test_tx_hash')
  isFrozen = vi.fn().mockResolvedValue(false)
  proposeDrain = vi.fn().mockResolvedValue('test_tx_hash')
  executeDrain = vi.fn().mockResolvedValue('test_tx_hash')
  setRecoveryDelay = vi.fn().mockResolvedValue('test_tx_hash')
  getCircuitBreakerState = vi.fn().mockResolvedValue({ frozen: false, drainProposed: false, recoveryDelay: 0 })
  stake = vi.fn().mockResolvedValue('')
  unstake = vi.fn().mockResolvedValue('')
  mvpStakedBalance = vi.fn().mockResolvedValue(BigInt(0))
  usedStake = vi.fn().mockResolvedValue(BigInt(0))
  unusedStake = vi.fn().mockResolvedValue(BigInt(0))
  utilizeStake = vi.fn().mockResolvedValue('')
  claimable = vi.fn().mockResolvedValue(BigInt(0))
  claim = vi.fn().mockResolvedValue('')
}

describe('Circuit Breaker Routes', () => {
  let app: express.Express
  let mockAdapter: MockSorobanAdapter

  beforeEach(() => {
    app = express()
    app.use(express.json())
    mockAdapter = new MockSorobanAdapter()
    app.use('/api/admin/circuit-breaker', createCircuitBreakerRouter(mockAdapter))
    app.use(errorHandler)
  })

  describe('POST /api/admin/circuit-breaker/freeze', () => {
    it('should freeze deal escrow with admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/freeze')
        .set('x-admin-secret', 'test-secret')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.txHash).toBe('test_tx_hash')
      expect(response.body.message).toBe('Deal escrow frozen successfully')
      expect(mockAdapter.freeze).toHaveBeenCalled()
    })

    it('should reject freeze without admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/freeze')

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/admin/circuit-breaker/status', () => {
    it('should get circuit breaker status with admin secret', async () => {
      const response = await request(app)
        .get('/api/admin/circuit-breaker/status')
        .set('x-admin-secret', 'test-secret')

      expect(response.status).toBe(200)
      expect(response.body.frozen).toBe(false)
      expect(response.body.state).toBeDefined()
      expect(mockAdapter.isFrozen).toHaveBeenCalled()
      expect(mockAdapter.getCircuitBreakerState).toHaveBeenCalled()
    })

    it('should reject status without admin secret', async () => {
      const response = await request(app)
        .get('/api/admin/circuit-breaker/status')

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/admin/circuit-breaker/propose-drain', () => {
    it('should propose drain with admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/propose-drain')
        .set('x-admin-secret', 'test-secret')
        .send({
          destination: 'GDESTINATION123456',
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.txHash).toBe('test_tx_hash')
      expect(response.body.message).toBe('Drain proposed successfully')
      expect(mockAdapter.proposeDrain).toHaveBeenCalledWith('GDESTINATION123456')
    })

    it('should reject propose-drain without admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/propose-drain')
        .send({
          destination: 'GDESTINATION123456',
        })

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/admin/circuit-breaker/execute-drain', () => {
    it('should execute drain with admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/execute-drain')
        .set('x-admin-secret', 'test-secret')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.txHash).toBe('test_tx_hash')
      expect(response.body.message).toBe('Drain executed successfully')
      expect(mockAdapter.executeDrain).toHaveBeenCalled()
    })

    it('should reject execute-drain without admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/execute-drain')

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/admin/circuit-breaker/set-recovery-delay', () => {
    it('should set recovery delay with admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/set-recovery-delay')
        .set('x-admin-secret', 'test-secret')
        .send({
          delaySeconds: 3600,
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.txHash).toBe('test_tx_hash')
      expect(response.body.message).toBe('Recovery delay set successfully')
      expect(mockAdapter.setRecoveryDelay).toHaveBeenCalledWith(3600)
    })

    it('should reject set-recovery-delay without admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/circuit-breaker/set-recovery-delay')
        .send({
          delaySeconds: 3600,
        })

      expect(response.status).toBe(403)
    })
  })
})
