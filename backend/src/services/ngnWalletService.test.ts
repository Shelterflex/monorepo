import { describe, it, expect, beforeEach } from 'vitest'
import { NgnWalletService } from './ngnWalletService.js'
import { ngnWalletStore } from '../models/ngnWalletStore.js'
import { ngnDepositStore } from '../models/ngnDepositStore.js'
import { depositStore } from '../models/depositStore.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { outboxStore } from '../outbox/index.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

describe('NgnWalletService - General-purpose balance, ledger, and withdrawal logic', () => {
  let service: NgnWalletService
  const userId = 'user-general-1'

  beforeEach(async () => {
    service = new NgnWalletService()
    await ngnWalletStore.clear()
    userRiskStateStore.clear()
    await depositStore.clear()
    await outboxStore.clear()
  })

  describe('Balance initialization and calculation', () => {
    it('initializes wallet with demo funds and calculates default balance correctly', async () => {
      const balance = await service.getBalance(userId)

      // Demo init creates 55,000 TOPUP_CONFIRMED and -5,000 STAKE_RESERVE
      expect(balance.availableNgn).toBe(50000)
      expect(balance.heldNgn).toBe(5000)
      expect(balance.totalNgn).toBe(55000)
    })

    it('returns the same wallet when requested multiple times', async () => {
      const b1 = await service.getBalance(userId)
      const b2 = await service.getBalance(userId)
      expect(b1).toEqual(b2)
    })

    it('updates available and total balance on manual adjustments', async () => {
      const wallet = await (service as any).getOrCreateWallet(userId)
      await ngnWalletStore.createLedgerEntry({
        walletId: wallet.walletId,
        type: 'ADJUSTMENT',
        amountNgn: 10000,
        referenceType: 'admin',
        referenceId: 'ADJ-001',
      })

      const balance = await service.getBalance(userId)
      expect(balance.availableNgn).toBe(60000)
      expect(balance.heldNgn).toBe(5000)
      expect(balance.totalNgn).toBe(65000)
    })
  })

  describe('Ledger operations', () => {
    it('returns ledger entries in reverse chronological order with pagination limit', async () => {
      const ledger = await service.getLedger(userId, { limit: 10 })

      expect(ledger.entries.length).toBeGreaterThanOrEqual(2)
      // First entry should be the most recently created (demo held: STAKE_RESERVE)
      expect(ledger.entries[0].type).toBe('STAKE_RESERVE')
      expect(ledger.entries[1].type).toBe('TOPUP_CONFIRMED')
      expect(ledger.nextCursor).toBeNull()
    })

    it('respects custom limit in getLedger', async () => {
      const ledger = await service.getLedger(userId, { limit: 1 })
      expect(ledger.entries).toHaveLength(1)
    })

    it('records pending top-up in the ledger', async () => {
      const deposit = await ngnDepositStore.create({
        userId,
        amountNgn: 25000,
        rail: 'bank_transfer',
      })

      await service.recordTopUpPending(deposit.depositId, 25000, 'FLW-001')

      const ledger = await service.getLedger(userId)
      const pendingEntry = ledger.entries.find((e) => e.type === 'TOPUP_PENDING')
      expect(pendingEntry).toBeDefined()
      expect(pendingEntry?.amountNgn).toBe(25000)
    })
  })

  describe('Top-up operations', () => {
    it('processTopUp credits balance and records confirmed top-up', async () => {
      const before = await service.getBalance(userId)
      const topUpAmount = 30000
      const ref = 'TOPUP-REF-001'

      await service.processTopUp(userId, topUpAmount, ref)

      const after = await service.getBalance(userId)
      expect(after.availableNgn).toBe(before.availableNgn + topUpAmount)
      expect(after.totalNgn).toBe(before.totalNgn + topUpAmount)

      const ledger = await service.getLedger(userId)
      const entry = ledger.entries.find((e) => e.referenceId === ref)
      expect(entry?.type).toBe('TOPUP_CONFIRMED')
      expect(entry?.amountNgn).toBe(topUpAmount)
    })

    it('processTopUp is idempotent for duplicate reference', async () => {
      const ref = 'TOPUP-IDEMP-001'
      await service.processTopUp(userId, 15000, ref)
      const bal1 = await service.getBalance(userId)

      await service.processTopUp(userId, 15000, ref)
      const bal2 = await service.getBalance(userId)

      expect(bal1.totalNgn).toBe(bal2.totalNgn)
    })

    it('creditTopUp credits once and ignores repeated calls with same depositId', async () => {
      const depositId = 'dep-credit-1'
      const ref = 'CREDIT-REF-1'
      const amount = 20000

      const first = await service.creditTopUp(userId, depositId, amount, ref)
      expect(first.credited).toBe(true)
      expect(first.newBalance.availableNgn).toBe(70000)

      const second = await service.creditTopUp(userId, depositId, amount, ref)
      expect(second.credited).toBe(false)
      expect(second.newBalance.availableNgn).toBe(70000)
    })

    it('reverseTopUp reduces available balance and clears credited status', async () => {
      const depositId = 'dep-rev-1'
      const ref = 'REV-REF-1'
      await service.creditTopUp(userId, depositId, 20000, ref)

      const revRes = await service.reverseTopUp(userId, depositId, 20000, 'REVERSAL-1')
      expect(revRes.reversed).toBe(true)
      expect(revRes.newBalance.availableNgn).toBe(50000)
    })

    it('unfreezes user when top-up restores negative balance to zero or positive', async () => {
      await userRiskStateStore.freeze(userId, 'NEGATIVE_BALANCE', 'Overdrawn')
      expect(await service.isUserFrozen(userId)).toBe(true)

      await service.processTopUp(userId, 10000, 'RESTORE-BAL')

      const riskState = await userRiskStateStore.getByUserId(userId)
      expect(riskState?.isFrozen).toBe(false)
    })
  })

  describe('Staking reserve and release operations', () => {
    it('reserves NGN for staking, decreasing available and increasing held', async () => {
      const res = await service.reserveNgnForStaking(userId, 'staking', 'STAKE-001', 10000)

      expect(res.reserved).toBe(true)
      expect(res.newBalance.availableNgn).toBe(40000)
      expect(res.newBalance.heldNgn).toBe(15000)
      expect(res.newBalance.totalNgn).toBe(55000)
    })

    it('reserveNgnForStaking is idempotent for duplicate reference', async () => {
      await service.reserveNgnForStaking(userId, 'staking', 'STAKE-IDEMP', 10000)
      const res = await service.reserveNgnForStaking(userId, 'staking', 'STAKE-IDEMP', 10000)

      expect(res.reserved).toBe(false)
      expect(res.newBalance.availableNgn).toBe(40000)
    })

    it('throws VALIDATION_ERROR (409) if reserve exceeds available balance', async () => {
      const balance = await service.getBalance(userId)

      await expect(
        service.reserveNgnForStaking(userId, 'staking', 'STAKE-TOO-MUCH', balance.availableNgn + 1),
      ).rejects.toMatchObject({
        status: 409,
        code: ErrorCode.VALIDATION_ERROR,
      })
    })

    it('releases NGN reserve, increasing available and decreasing held', async () => {
      await service.reserveNgnForStaking(userId, 'staking', 'STAKE-REL', 10000)
      const res = await service.releaseNgnReserve(userId, 'staking', 'STAKE-REL', 10000)

      expect(res.released).toBe(true)
      expect(res.newBalance.availableNgn).toBe(50000)
      expect(res.newBalance.heldNgn).toBe(5000)
    })

    it('debits NGN for conversion, reducing held balance', async () => {
      await service.reserveNgnForStaking(userId, 'staking', 'CONV-STAKE', 10000)
      const res = await service.debitNgnForConversion(userId, 'conversion', 'CONV-001', 10000)

      expect(res.debited).toBe(true)
      expect(res.newBalance.heldNgn).toBe(5000)
      expect(res.newBalance.totalNgn).toBe(45000)
    })
  })

  describe('Withdrawal operations', () => {
    it('initiates withdrawal successfully using explicit bankAccount', async () => {
      const request = {
        amountNgn: 15000,
        bankAccount: {
          accountNumber: '0123456789',
          accountName: 'Jane Doe',
          bankName: 'Access Bank',
        },
      }

      const withdrawal = await service.initiateWithdrawal(userId, request)

      expect(withdrawal.id).toBeDefined()
      expect(withdrawal.status).toBe('pending')
      expect(withdrawal.amountNgn).toBe(15000)
      expect(withdrawal.bankAccount.accountNumber).toBe('0123456789')

      const balance = await service.getBalance(userId)
      expect(balance.availableNgn).toBe(35000)
      expect(balance.heldNgn).toBe(20000)
    })

    it('initiates withdrawal successfully using registered bankAccountRef', async () => {
      const request = {
        amountNgn: 5000,
        bankAccountRef: 'ba-demo-1',
      }

      const withdrawal = await service.initiateWithdrawal(userId, request)
      expect(withdrawal.bankAccount.accountNumber).toBe('1234567890')
      expect(withdrawal.bankAccount.bankName).toBe('Guaranty Trust Bank')
    })

    it('rejects withdrawal if bankAccountRef is unknown', async () => {
      await expect(
        service.initiateWithdrawal(userId, {
          amountNgn: 5000,
          bankAccountRef: 'unknown-ref',
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Unknown bankAccountRef',
      })
    })

    it('rejects withdrawal if neither bankAccount nor bankAccountRef is provided', async () => {
      await expect(
        service.initiateWithdrawal(userId, {
          amountNgn: 5000,
        } as any),
      ).rejects.toMatchObject({
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      })
    })

    it('rejects withdrawal if requested amount exceeds available balance', async () => {
      await expect(
        service.initiateWithdrawal(userId, {
          amountNgn: 60000,
          bankAccountRef: 'ba-demo-1',
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      })
    })

    it('rejects withdrawal if user account is frozen', async () => {
      await userRiskStateStore.freeze(userId, 'COMPLIANCE', 'Under audit')

      await expect(
        service.initiateWithdrawal(userId, {
          amountNgn: 1000,
          bankAccountRef: 'ba-demo-1',
        }),
      ).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.ACCOUNT_FROZEN,
      })
    })

    it('confirms pending withdrawal and moves held balance out', async () => {
      const withdrawal = await service.initiateWithdrawal(userId, {
        amountNgn: 10000,
        bankAccountRef: 'ba-demo-1',
      })

      const confirmed = await service.confirmWithdrawal(withdrawal.id)
      expect(confirmed.status).toBe('confirmed')
      expect(confirmed.processedAt).toBeDefined()

      const balance = await service.getBalance(userId)
      expect(balance.availableNgn).toBe(40000)
      expect(balance.heldNgn).toBe(5000)
      expect(balance.totalNgn).toBe(45000)
    })

    it('confirmWithdrawal is idempotent if already confirmed', async () => {
      const withdrawal = await service.initiateWithdrawal(userId, {
        amountNgn: 10000,
        bankAccountRef: 'ba-demo-1',
      })

      await service.confirmWithdrawal(withdrawal.id)
      const secondCall = await service.confirmWithdrawal(withdrawal.id)
      expect(secondCall.status).toBe('confirmed')
    })

    it('throws NOT_FOUND (404) when confirming non-existent withdrawal', async () => {
      await expect(service.confirmWithdrawal('non-existent-wd')).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.NOT_FOUND,
      })
    })

    it('fails withdrawal and restores available funds', async () => {
      const withdrawal = await service.initiateWithdrawal(userId, {
        amountNgn: 10000,
        bankAccountRef: 'ba-demo-1',
      })

      const failed = await service.failWithdrawal(withdrawal.id, 'Destination bank rejected transfer')
      expect(failed.status).toBe('failed')
      expect(failed.failureReason).toBe('Destination bank rejected transfer')

      const balance = await service.getBalance(userId)
      expect(balance.availableNgn).toBe(50000)
      expect(balance.heldNgn).toBe(5000)
      expect(balance.totalNgn).toBe(55000)
    })

    it('approves withdrawal via approveWithdrawal helper', async () => {
      const withdrawal = await service.initiateWithdrawal(userId, {
        amountNgn: 5000,
        bankAccountRef: 'ba-demo-1',
      })

      const approved = await service.approveWithdrawal(withdrawal.id)
      expect(approved.status).toBe('confirmed')
    })

    it('rejects withdrawal via rejectWithdrawal helper', async () => {
      const withdrawal = await service.initiateWithdrawal(userId, {
        amountNgn: 5000,
        bankAccountRef: 'ba-demo-1',
      })

      const rejected = await service.rejectWithdrawal(withdrawal.id, 'Admin flagged suspicious')
      expect(rejected.status).toBe('rejected')
      expect(rejected.failureReason).toBe('Admin flagged suspicious')

      const balance = await service.getBalance(userId)
      expect(balance.availableNgn).toBe(50000)
    })

    it('lists withdrawal history for a user with limit', async () => {
      await service.initiateWithdrawal(userId, {
        amountNgn: 2000,
        bankAccountRef: 'ba-demo-1',
      })

      const history = await service.listWithdrawals(userId, { limit: 5 })
      expect(history.entries.length).toBeGreaterThanOrEqual(1)
      expect(history.entries[0].amountNgn).toBe(2000)
    })
  })

  describe('Account freeze and negative balance queries', () => {
    it('identifies frozen user by risk store manual freeze', async () => {
      await userRiskStateStore.freeze(userId, 'MANUAL', 'Admin froze account')
      expect(await service.isUserFrozen(userId)).toBe(true)

      await expect(service.requireNotFrozen(userId)).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.ACCOUNT_FROZEN,
        message: expect.stringContaining('Manual freeze by admin'),
      })
    })

    it('identifies frozen user by compliance freeze', async () => {
      await userRiskStateStore.freeze(userId, 'COMPLIANCE', 'KYC needed')

      await expect(service.requireNotFrozen(userId)).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.ACCOUNT_FROZEN,
        message: expect.stringContaining('Compliance review required'),
      })
    })

    it('lists negative balance wallets', async () => {
      // User with positive balance
      await service.getBalance('user-pos')

      // Create a wallet and force negative ledger entry
      const negWallet = await (service as any).getOrCreateWallet('user-neg')
      await ngnWalletStore.createLedgerEntry({
        walletId: negWallet.walletId,
        type: 'TOPUP_REVERSED',
        amountNgn: -100000,
        referenceType: 'admin',
        referenceId: 'REV-NEG-1',
      })

      const negativeOnly = await service.listNegativeBalances({ limit: 10 })
      expect(negativeOnly.items.some((i) => i.userId === 'user-neg')).toBe(true)
      expect(negativeOnly.items.some((i) => i.userId === 'user-pos')).toBe(false)

      const all = await service.listNegativeBalances({ limit: 10, includeNonNegative: true })
      expect(all.items.some((i) => i.userId === 'user-neg')).toBe(true)
      expect(all.items.some((i) => i.userId === 'user-pos')).toBe(true)
    })
  })
})
