import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { createVestingScheduleRouter } from './vestingSchedule.js'
import { SorobanAdapter } from '../soroban/adapter.js'

// Mock the env module
vi.mock('../schemas/env.js', () => ({
  env: {
    MANUAL_ADMIN_SECRET: 'test-secret',
  },
}))

class MockSorobanAdapter implements SorobanAdapter {
  createVestingSchedule = vi.fn().mockResolvedValue('test_tx_hash')
  revokeVesting = vi.fn().mockResolvedValue(BigInt(500000))
  claimVested = vi.fn().mockResolvedValue(BigInt(100000))
  getClaimableVested = vi.fn().mockResolvedValue(BigInt(100000))
  
  // Stub other required methods
  getBalance = vi.fn().mockResolvedValue(BigInt(0))
  credit = vi.fn().mockResolvedValue(undefined)
  debit = vi.fn().mockResolvedValue(undefined)
  getStakedBalance = vi.fn().mockResolvedValue(BigInt(0))
  getClaimableRewards = vi.fn().mockResolvedValue(BigInt(0))
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
  getDelegationEpoch = vi.fn().mockResolvedValue(1)
  getDelegateeClaimable = vi.fn().mockResolvedValue(BigInt(0))
  getDelegateeCommissionClaimable = vi.fn().mockResolvedValue(BigInt(0))
  getOraclePrice = vi.fn().mockResolvedValue({ price: BigInt(0), decimals: 7, updatedAt: 0, sequence: 0 })
  isOraclePriceStale = vi.fn().mockResolvedValue(false)
  epochStake = vi.fn().mockResolvedValue('')
  epochUnstake = vi.fn().mockResolvedValue('')
  epochClaim = vi.fn().mockResolvedValue(BigInt(0))
  epochGetClaimable = vi.fn().mockResolvedValue(BigInt(0))
  epochGetEpoch = vi.fn().mockResolvedValue(null)
  epochGetCurrentEpoch = vi.fn().mockResolvedValue(1)
  epochGetTotalStaked = vi.fn().mockResolvedValue(BigInt(0))
  epochFundRewards = vi.fn().mockResolvedValue('')
  epochSeal = vi.fn().mockResolvedValue('')
  rentWalletCredit = vi.fn().mockResolvedValue('')
  rentWalletDebit = vi.fn().mockResolvedValue('')
  rentWalletBalance = vi.fn().mockResolvedValue(BigInt(0))
  submitEvidence = vi.fn().mockResolvedValue(0)
  revealEvidence = vi.fn().mockResolvedValue(undefined)
  proposeSlash = vi.fn().mockResolvedValue(0)
  finalizeSlash = vi.fn().mockResolvedValue(undefined)
  cancelSlash = vi.fn().mockResolvedValue(undefined)
  depositBond = vi.fn().mockResolvedValue(undefined)
  withdrawBond = vi.fn().mockResolvedValue(undefined)
  getBondBalance = vi.fn().mockResolvedValue(BigInt(0))
  updateTenantReputation = vi.fn().mockResolvedValue(undefined)
  getTenantReputation = vi.fn().mockResolvedValue(null)
  createProposal = vi.fn().mockResolvedValue({ xdr: '' })
  vote = vi.fn().mockResolvedValue({ xdr: '' })
  submitGovernanceTransaction = vi.fn().mockResolvedValue({ txHash: '' })
  finalizeProposal = vi.fn().mockResolvedValue('')
  executeProposal = vi.fn().mockResolvedValue('')
  getProposal = vi.fn().mockResolvedValue(null)
  getProposalCount = vi.fn().mockResolvedValue(0)
  getReceiptById = vi.fn().mockResolvedValue(null)
  listReceiptsByDeal = vi.fn().mockResolvedValue([])
  listReceiptsByUser = vi.fn().mockResolvedValue([])
  addToAllowlist = vi.fn().mockResolvedValue('')
  removeFromAllowlist = vi.fn().mockResolvedValue('')
  isAllowlisted = vi.fn().mockResolvedValue(false)
  getAllowlistEntry = vi.fn().mockResolvedValue(null)
  getTransactionStatus = vi.fn().mockResolvedValue({ status: 'not_found' })
  stake = vi.fn().mockResolvedValue('')
  unstake = vi.fn().mockResolvedValue('')
  mvpStakedBalance = vi.fn().mockResolvedValue(BigInt(0))
  usedStake = vi.fn().mockResolvedValue(BigInt(0))
  unusedStake = vi.fn().mockResolvedValue(BigInt(0))
  utilizeStake = vi.fn().mockResolvedValue('')
  claimable = vi.fn().mockResolvedValue(BigInt(0))
  claim = vi.fn().mockResolvedValue('')
}

describe('Vesting Schedule Routes', () => {
  let app: express.Express
  let mockAdapter: MockSorobanAdapter

  beforeEach(() => {
    app = express()
    app.use(express.json())
    mockAdapter = new MockSorobanAdapter()
    app.use('/api/admin/vesting-schedule', createVestingScheduleRouter(mockAdapter))
    app.use('/api/vesting-schedule', createVestingScheduleRouter(mockAdapter))
    app.use(errorHandler)
  })

  describe('POST /api/admin/vesting-schedule/create', () => {
    it('should create a vesting schedule with admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/vesting-schedule/create')
        .set('x-admin-secret', 'test-secret')
        .send({
          beneficiary: 'GTEST123456789',
          totalAmount: '1000000',
          startTime: Math.floor(Date.now() / 1000),
          endTime: Math.floor(Date.now() / 1000) + 86400 * 365,
          cliffTime: Math.floor(Date.now() / 1000) + 86400 * 90,
          revocable: true,
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.txHash).toBe('test_tx_hash')
      expect(response.body.message).toBe('Vesting schedule created successfully')
      expect(mockAdapter.createVestingSchedule).toHaveBeenCalledWith(
        'GTEST123456789',
        BigInt(1000000),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        true
      )
    })

    it('should reject creation without admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/vesting-schedule/create')
        .send({
          beneficiary: 'GTEST123456789',
          totalAmount: '1000000',
          startTime: Math.floor(Date.now() / 1000),
          endTime: Math.floor(Date.now() / 1000) + 86400 * 365,
          cliffTime: Math.floor(Date.now() / 1000) + 86400 * 90,
          revocable: true,
        })

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/admin/vesting-schedule/revoke', () => {
    it('should revoke a vesting schedule with admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/vesting-schedule/revoke')
        .set('x-admin-secret', 'test-secret')
        .send({
          beneficiary: 'GTEST123456789',
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.unclaimedAmount).toBe('500000')
      expect(response.body.message).toBe('Vesting schedule revoked successfully')
      expect(mockAdapter.revokeVesting).toHaveBeenCalledWith('GTEST123456789')
    })

    it('should reject revocation without admin secret', async () => {
      const response = await request(app)
        .post('/api/admin/vesting-schedule/revoke')
        .send({
          beneficiary: 'GTEST123456789',
        })

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/vesting-schedule/claimable', () => {
    it('should get claimable amount for a beneficiary', async () => {
      const response = await request(app)
        .get('/api/vesting-schedule/claimable')
        .query({
          beneficiary: 'GTEST123456789',
        })

      expect(response.status).toBe(200)
      expect(response.body.beneficiary).toBe('GTEST123456789')
      expect(response.body.claimableAmount).toBe('100000')
      expect(mockAdapter.getClaimableVested).toHaveBeenCalledWith('GTEST123456789')
    })
  })

  describe('POST /api/vesting-schedule/claim', () => {
    it('should claim vested tokens for a beneficiary', async () => {
      const response = await request(app)
        .post('/api/vesting-schedule/claim')
        .send({
          beneficiary: 'GTEST123456789',
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.beneficiary).toBe('GTEST123456789')
      expect(response.body.claimedAmount).toBe('100000')
      expect(response.body.message).toBe('Vested tokens claimed successfully')
      expect(mockAdapter.claimVested).toHaveBeenCalledWith('GTEST123456789')
    })
  })
})
