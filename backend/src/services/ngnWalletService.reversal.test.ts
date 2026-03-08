import { describe, it, expect, beforeEach } from 'vitest'
import { NgnWalletService } from './ngnWalletService.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { depositStore } from '../models/depositStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

describe('NgnWalletService - Reversal & Freeze Logic', () => {
  let service: NgnWalletService
  const testUserId = 'test-user-123'
  const testDepositId = 'deposit-456'

  beforeEach(async () => {
    service = new NgnWalletService()
    userRiskStateStore.clear()
    await depositStore.clear()
  })

  describe('processDepositReversal', () => {
    it('should reverse a confirmed deposit and debit the wallet', async () => {
      // Setup: Create a confirmed deposit
      await depositStore.confirm({
        depositId: testDepositId,
        userId: testUserId,
        amountNgn: 10000,
        provider: 'onramp',
        providerRef: 'ONRAMP-REF-123',
      })

      // Setup: Give user initial balance
      const initialBalance = await service.getBalance(testUserId)
      const expectedNewTotal = initialBalance.totalNgn - 10000

      // Act: Process reversal
      await service.processDepositReversal('onramp', 'ONRAMP-REF-123', 'REVERSAL-REF-789')

      // Assert: Balance should be reduced
      const newBalance = await service.getBalance(testUserId)
      expect(newBalance.totalNgn).toBe(expectedNewTotal)
      expect(newBalance.availableNgn).toBe(initialBalance.availableNgn - 10000)

      // Assert: Deposit should be marked as reversed
      const deposit = await depositStore.getById(testDepositId)
      expect(deposit?.reversedAt).toBeTruthy()
      expect(deposit?.reversalRef).toBe('REVERSAL-REF-789')

      // Assert: Ledger should have reversal entry
      const ledger = await service.getLedger(testUserId)
      const reversalEntry = ledger.entries.find((e) => e.type === 'top_up_reversed')
      expect(reversalEntry).toBeTruthy()
      expect(reversalEntry?.amountNgn).toBe(-10000)
    })

    it('should freeze user when reversal makes balance negative', async () => {
      // Setup: Create a confirmed deposit
      await depositStore.confirm({
        depositId: testDepositId,
        userId: testUserId,
        amountNgn: 100000,
        provider: 'onramp',
        providerRef: 'ONRAMP-REF-456',
      })

      // Setup: User has small balance
      const initialBalance = await service.getBalance(testUserId)
      expect(initialBalance.totalNgn).toBeLessThan(100000)

      // Act: Process reversal that will make balance negative
      await service.processDepositReversal('onramp', 'ONRAMP-REF-456', 'REVERSAL-REF-999')

      // Assert: Balance should be negative
      const newBalance = await service.getBalance(testUserId)
      expect(newBalance.totalNgn).toBeLessThan(0)

      // Assert: User should be frozen
      const riskState = await userRiskStateStore.getByUserId(testUserId)
      expect(riskState?.isFrozen).toBe(true)
      expect(riskState?.freezeReason).toBe('NEGATIVE_BALANCE')
    })

    it('should be idempotent - processing same reversal twice should not double-debit', async () => {
      // Setup: Create a confirmed deposit
      await depositStore.confirm({
        depositId: testDepositId,
        userId: testUserId,
        amountNgn: 10000,
        provider: 'onramp',
        providerRef: 'ONRAMP-REF-789',
      })

      const initialBalance = await service.getBalance(testUserId)

      // Act: Process reversal twice
      await service.processDepositReversal('onramp', 'ONRAMP-REF-789', 'REVERSAL-REF-111')
      const balanceAfterFirst = await service.getBalance(testUserId)

      await service.processDepositReversal('onramp', 'ONRAMP-REF-789', 'REVERSAL-REF-111')
      const balanceAfterSecond = await service.getBalance(testUserId)

      // Assert: Balance should only be debited once
      expect(balanceAfterFirst.totalNgn).toBe(initialBalance.totalNgn - 10000)
      expect(balanceAfterSecond.totalNgn).toBe(balanceAfterFirst.totalNgn)
    })

    it('should throw NOT_FOUND if deposit does not exist', async () => {
      await expect(
        service.processDepositReversal('onramp', 'NONEXISTENT-REF', 'REVERSAL-REF-222')
      ).rejects.toThrow(AppError)

      try {
        await service.processDepositReversal('onramp', 'NONEXISTENT-REF', 'REVERSAL-REF-222')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND)
      }
    })
  })

  describe('processTopUp', () => {
    it('should credit wallet and add ledger entry', async () => {
      const initialBalance = await service.getBalance(testUserId)

      await service.processTopUp(testUserId, 20000, 'TOPUP-REF-333')

      const newBalance = await service.getBalance(testUserId)
      expect(newBalance.totalNgn).toBe(initialBalance.totalNgn + 20000)
      expect(newBalance.availableNgn).toBe(initialBalance.availableNgn + 20000)

      const ledger = await service.getLedger(testUserId)
      const topUpEntry = ledger.entries.find((e) => e.type === 'top_up')
      expect(topUpEntry).toBeTruthy()
      expect(topUpEntry?.amountNgn).toBe(20000)
    })

    it('should auto-unfreeze user when balance becomes non-negative (NEGATIVE_BALANCE only)', async () => {
      // Setup: Freeze user due to negative balance
      await userRiskStateStore.freeze(testUserId, 'NEGATIVE_BALANCE', 'Test freeze')
      
      // Setup: Set negative balance
      const currentBalance = await service.getBalance(testUserId)
      const deficit = Math.abs(currentBalance.totalNgn) + 1000

      // Act: Top up enough to make balance positive
      await service.processTopUp(testUserId, deficit + 5000, 'TOPUP-REF-444')

      // Assert: User should be unfrozen
      const riskState = await userRiskStateStore.getByUserId(testUserId)
      expect(riskState?.isFrozen).toBe(false)

      // Assert: Balance should be positive
      const newBalance = await service.getBalance(testUserId)
      expect(newBalance.totalNgn).toBeGreaterThanOrEqual(0)
    })

    it('should NOT auto-unfreeze if freeze reason is MANUAL', async () => {
      // Setup: Manually freeze user
      await userRiskStateStore.freeze(testUserId, 'MANUAL', 'Admin freeze')

      // Act: Top up
      await service.processTopUp(testUserId, 50000, 'TOPUP-REF-555')

      // Assert: User should still be frozen
      const riskState = await userRiskStateStore.getByUserId(testUserId)
      expect(riskState?.isFrozen).toBe(true)
      expect(riskState?.freezeReason).toBe('MANUAL')
    })

    it('should NOT auto-unfreeze if freeze reason is COMPLIANCE', async () => {
      // Setup: Compliance freeze
      await userRiskStateStore.freeze(testUserId, 'COMPLIANCE', 'Under review')

      // Act: Top up
      await service.processTopUp(testUserId, 50000, 'TOPUP-REF-666')

      // Assert: User should still be frozen
      const riskState = await userRiskStateStore.getByUserId(testUserId)
      expect(riskState?.isFrozen).toBe(true)
      expect(riskState?.freezeReason).toBe('COMPLIANCE')
    })
  })

  describe('requireNotFrozen', () => {
    it('should throw ACCOUNT_FROZEN error when user is frozen', async () => {
      await userRiskStateStore.freeze(testUserId, 'NEGATIVE_BALANCE', 'Test freeze')

      await expect(service.requireNotFrozen(testUserId)).rejects.toThrow(AppError)

      try {
        await service.requireNotFrozen(testUserId)
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCode.ACCOUNT_FROZEN)
        expect((error as AppError).status).toBe(403)
      }
    })

    it('should not throw when user is not frozen', async () => {
      await expect(service.requireNotFrozen(testUserId)).resolves.not.toThrow()
    })
  })

  describe('initiateWithdrawal', () => {
    it('should block withdrawal when user is frozen', async () => {
      await userRiskStateStore.freeze(testUserId, 'MANUAL', 'Admin freeze')

      await expect(
        service.initiateWithdrawal(testUserId, {
          amountNgn: 1000,
          bankAccount: {
            accountNumber: '1234567890',
            accountName: 'Test User',
            bankName: 'Test Bank',
          },
        })
      ).rejects.toThrow(AppError)

      try {
        await service.initiateWithdrawal(testUserId, {
          amountNgn: 1000,
          bankAccount: {
            accountNumber: '1234567890',
            accountName: 'Test User',
            bankName: 'Test Bank',
          },
        })
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCode.ACCOUNT_FROZEN)
      }
    })

    it('should allow withdrawal when user is not frozen', async () => {
      const withdrawal = await service.initiateWithdrawal(testUserId, {
        amountNgn: 1000,
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank',
        },
      })

      expect(withdrawal).toBeTruthy()
      expect(withdrawal.status).toBe('pending')
      expect(withdrawal.amountNgn).toBe(1000)
    })
  })

  describe('Edge cases', () => {
    it('should handle reversal after user has reserved funds for staking', async () => {
      // Setup: Create deposit and confirm
      await depositStore.confirm({
        depositId: testDepositId,
        userId: testUserId,
        amountNgn: 50000,
        provider: 'onramp',
        providerRef: 'ONRAMP-REF-EDGE-1',
      })

      // Setup: User initiates withdrawal (reserves funds)
      await service.initiateWithdrawal(testUserId, {
        amountNgn: 10000,
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank',
        },
      })

      const balanceBeforeReversal = await service.getBalance(testUserId)
      expect(balanceBeforeReversal.heldNgn).toBeGreaterThan(0)

      // Act: Process reversal
      await service.processDepositReversal('onramp', 'ONRAMP-REF-EDGE-1', 'REVERSAL-REF-EDGE-1')

      // Assert: Reversal should still apply
      const balanceAfterReversal = await service.getBalance(testUserId)
      expect(balanceAfterReversal.totalNgn).toBe(balanceBeforeReversal.totalNgn - 50000)

      // Assert: Held funds should remain (not silently cancelled)
      expect(balanceAfterReversal.heldNgn).toBe(balanceBeforeReversal.heldNgn)

      // Assert: User may be frozen if balance is negative
      if (balanceAfterReversal.totalNgn < 0) {
        const riskState = await userRiskStateStore.getByUserId(testUserId)
        expect(riskState?.isFrozen).toBe(true)
      }
    })
  })
})
