import {
  WithdrawalRequest,
  WithdrawalResponse,
  WithdrawalHistoryResponse,
  NgnBalanceResponse,
  NgnLedgerResponse,
  NgnLedgerEntry
} from '../schemas/ngnWallet.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { depositStore } from '../models/depositStore.js'
import { getPaymentProvider } from '../payments/index.js'

export class NgnWalletService {
  // In-memory storage for demo purposes
  // In production, this would be replaced with a proper database
  private withdrawals: WithdrawalResponse[] = []
  private withdrawalUserIds: Map<string, string> = new Map()
  private ledger: NgnLedgerEntry[] = []
  private balances: Map<string, NgnBalanceResponse> = new Map()
  private bankAccountsByRef: Map<string, { accountNumber: string; accountName: string; bankName: string }> = new Map()
  // Track credited deposits to prevent double-crediting (idempotency)
  private creditedDeposits = new Set<string>()
  // Track staking reservations by canonical ref (source:ref) for idempotency
  private stakingReservations = new Map<string, { amountNgn: number; timestamp: string }>()

  constructor() {
    // Initialize with some demo data
    this.initializeDemoData()
  }

  private initializeDemoData() {
    // Set up demo user balances
    this.balances.set('63468761-0500-4dd9-9d75-c30cbc8d42da', {
      availableNgn: 50000,
      heldNgn: 5000,
      totalNgn: 55000
    })

    // Add some demo ledger entries
    this.ledger = [
      {
        id: '1',
        type: 'top_up',
        amountNgn: 10000,
        status: 'confirmed',
        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        reference: 'TOPUP-001'
      },
      {
        id: '2',
        type: 'withdrawal',
        amountNgn: -5000,
        status: 'confirmed',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        reference: 'WD-001'
      },
      {
        id: '3',
        type: 'withdrawal',
        amountNgn: -2000,
        status: 'pending',
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        reference: 'WD-002'
      }
    ]

    // Add some demo withdrawals
    this.withdrawals = [
      {
        id: 'wd-1',
        amountNgn: 5000,
        status: 'confirmed',
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'John Doe',
          bankName: 'Guaranty Trust Bank'
        },
        reference: 'WD-001',
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        processedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        failureReason: null
      },
      {
        id: 'wd-2',
        amountNgn: 2000,
        status: 'pending',
        bankAccount: {
          accountNumber: '0987654321',
          accountName: 'John Doe',
          bankName: 'First Bank of Nigeria'
        },
        reference: 'WD-002',
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        processedAt: null,
        failureReason: null
      }
    ]

    // Demo bank account references
    this.bankAccountsByRef.set('ba-demo-1', {
      accountNumber: '1234567890',
      accountName: 'John Doe',
      bankName: 'Guaranty Trust Bank',
    })
  }

  private resolveBankAccount(request: WithdrawalRequest): { accountNumber: string; accountName: string; bankName: string } {
    if (request.bankAccount) {
      return request.bankAccount
    }

    if (request.bankAccountRef) {
      const bankAccount = this.bankAccountsByRef.get(request.bankAccountRef)
      if (!bankAccount) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Unknown bankAccountRef')
      }
      return bankAccount
    }

    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Either bankAccountRef or bankAccount is required')
  }

  async getBalance(userId: string): Promise<NgnBalanceResponse> {
    logger.info('Getting NGN balance', { userId })

    let balance = this.balances.get(userId)
    if (!balance) {
      balance = {
        availableNgn: 50000,
        heldNgn: 5000,
        totalNgn: 55000,
      }
      this.balances.set(userId, balance)
    }

    return balance
  }

  /**
   * Check if user is frozen (either by negative balance or manual freeze)
   */
  async isUserFrozen(userId: string): Promise<boolean> {
    const riskState = await userRiskStateStore.getByUserId(userId)
    if (riskState?.isFrozen) {
      return true
    }

    const balance = await this.getBalance(userId)
    return balance.totalNgn < 0
  }

  /**
   * Ensure user is not frozen before allowing risky operations
   */
  async requireNotFrozen(userId: string): Promise<void> {
    const frozen = await this.isUserFrozen(userId)
    if (frozen) {
      const balance = await this.getBalance(userId)
      const riskState = await userRiskStateStore.getByUserId(userId)

      let message = 'Account frozen. '
      if (balance.totalNgn < 0) {
        message += `Negative balance: ${balance.totalNgn} NGN. Please top up to continue.`
      } else if (riskState?.freezeReason === 'MANUAL') {
        message += 'Manual freeze by admin. Contact support.'
      } else if (riskState?.freezeReason === 'COMPLIANCE') {
        message += 'Compliance review required. Contact support.'
      }

      throw new AppError(ErrorCode.ACCOUNT_FROZEN, 403, message)
    }
  }

  /**
   * Process a deposit reversal/chargeback
   * This is idempotent based on (provider, providerRef, eventType)
   */
  async processDepositReversal(
    provider: string,
    providerRef: string,
    reversalRef: string
  ): Promise<void> {
    logger.info('Processing deposit reversal', { provider, providerRef, reversalRef })

    // Find the original deposit
    const deposit = await depositStore.getByProviderRef(provider, providerRef)
    if (!deposit) {
      logger.warn('Deposit not found for reversal', { provider, providerRef })
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Original deposit not found')
    }

    // Idempotent check - if already reversed, skip
    if (deposit.reversedAt) {
      logger.info('Deposit already reversed, skipping', {
        depositId: deposit.depositId,
        reversedAt: deposit.reversedAt
      })
      return
    }

    // Mark deposit as reversed
    await depositStore.markReversed(deposit.depositId, reversalRef)

    // Write reversal ledger entry (negative amount)
    const reversalEntry: NgnLedgerEntry = {
      id: `reversal-${deposit.depositId}`,
      type: 'top_up_reversed',
      amountNgn: -deposit.amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference: reversalRef,
    }
    this.ledger.unshift(reversalEntry)

    // Update user balance
    const balance = await this.getBalance(deposit.userId)
    const newTotalNgn = balance.totalNgn - deposit.amountNgn
    const newAvailableNgn = balance.availableNgn - deposit.amountNgn

    this.balances.set(deposit.userId, {
      availableNgn: newAvailableNgn,
      heldNgn: balance.heldNgn,
      totalNgn: newTotalNgn,
    })

    logger.info('Balance updated after reversal', {
      userId: deposit.userId,
      oldTotal: balance.totalNgn,
      newTotal: newTotalNgn,
      reversalAmount: deposit.amountNgn,
    })

    // Auto-freeze if balance is now negative
    if (newTotalNgn < 0) {
      await userRiskStateStore.freeze(
        deposit.userId,
        'NEGATIVE_BALANCE',
        `Auto-frozen due to deposit reversal. Deficit: ${Math.abs(newTotalNgn)} NGN`
      )
      logger.warn('User frozen due to negative balance after reversal', {
        userId: deposit.userId,
        totalNgn: newTotalNgn,
      })
    }
  }

  /**
   * Process a top-up and auto-unfreeze if balance becomes positive
   */
  async processTopUp(userId: string, amountNgn: number, reference: string): Promise<void> {
    logger.info('Processing top-up', { userId, amountNgn, reference })

    const balance = await this.getBalance(userId)
    const newTotalNgn = balance.totalNgn + amountNgn
    const newAvailableNgn = balance.availableNgn + amountNgn

    this.balances.set(userId, {
      availableNgn: newAvailableNgn,
      heldNgn: balance.heldNgn,
      totalNgn: newTotalNgn,
    })

    // Add ledger entry
    const topUpEntry: NgnLedgerEntry = {
      id: `topup-${Date.now()}`,
      type: 'top_up',
      amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference,
    }
    this.ledger.unshift(topUpEntry)

    logger.info('Balance updated after top-up', {
      userId,
      oldTotal: balance.totalNgn,
      newTotal: newTotalNgn,
      topUpAmount: amountNgn,
    })

    // Auto-unfreeze if balance is now non-negative and freeze reason is NEGATIVE_BALANCE
    const riskState = await userRiskStateStore.getByUserId(userId)
    if (riskState?.isFrozen && riskState.freezeReason === 'NEGATIVE_BALANCE' && newTotalNgn >= 0) {
      await userRiskStateStore.unfreeze(
        userId,
        `Auto-unfrozen after top-up. Balance restored to ${newTotalNgn} NGN`
      )
      logger.info('User auto-unfrozen after balance restored', {
        userId,
        totalNgn: newTotalNgn,
      })
    }
  }

  async getLedger(userId: string, options: { limit?: number; cursor?: string } = {}): Promise<NgnLedgerResponse> {
    logger.info('Getting NGN ledger', { userId, options })

    let entries = [...this.ledger].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    const limit = options.limit || 20
    entries = entries.slice(0, limit)

    return {
      entries,
      nextCursor: null
    }
  }

  async recordTopUpPending(depositId: string, amountNgn: number, reference: string): Promise<void> {
    const entry: NgnLedgerEntry = {
      id: depositId,
      type: 'topup_pending',
      amountNgn,
      status: 'pending',
      timestamp: new Date().toISOString(),
      reference,
    }
    this.ledger.unshift(entry)
  }

  async initiateWithdrawal(userId: string, request: WithdrawalRequest): Promise<WithdrawalResponse> {
    logger.info('Initiating withdrawal', { userId, amount: request.amountNgn })

    // Check if user is frozen
    await this.requireNotFrozen(userId)

    // Check user balance
    const balance = await this.getBalance(userId)
    if (request.amountNgn > balance.availableNgn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `Insufficient balance. Available: ${balance.availableNgn}, Requested: ${request.amountNgn}`
      )
    }

    // Create withdrawal record
    const withdrawal: WithdrawalResponse = {
      id: `wd-${Date.now()}`,
      amountNgn: request.amountNgn,
      status: 'pending',
      bankAccount: this.resolveBankAccount(request),
      reference: `WD-${Date.now()}`,
      createdAt: new Date().toISOString(),
      processedAt: null,
      failureReason: null
    }

    // Update held funds
    const updatedBalance: NgnBalanceResponse = {
      availableNgn: balance.availableNgn - request.amountNgn,
      heldNgn: balance.heldNgn + request.amountNgn,
      totalNgn: balance.totalNgn
    }
    this.balances.set(userId, updatedBalance)

    // Add to withdrawals
    this.withdrawals.unshift(withdrawal)
    this.withdrawalUserIds.set(withdrawal.id, userId)

    // Add to ledger
    const ledgerEntry: NgnLedgerEntry = {
      id: withdrawal.id,
      type: 'withdrawal',
      amountNgn: -request.amountNgn,
      status: 'pending',
      timestamp: withdrawal.createdAt,
      reference: withdrawal.reference
    }
    this.ledger.unshift(ledgerEntry)

    logger.info('Withdrawal initiated successfully', {
      userId,
      withdrawalId: withdrawal.id,
      amount: request.amountNgn
    })

    return withdrawal
  }

  async listWithdrawals(userId: string, options: { limit?: number; cursor?: string } = {}): Promise<WithdrawalHistoryResponse> {
    return this.getWithdrawalHistory(userId, options)
  }

  private requireWithdrawalForAdminAction(withdrawalId: string): WithdrawalResponse {
    const withdrawal = this.withdrawals.find((w) => w.id === withdrawalId)
    if (!withdrawal) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Withdrawal not found')
    }
    return withdrawal
  }

  private updateLedgerStatus(withdrawalId: string, status: WithdrawalResponse['status']): void {
    const ledgerEntry = this.ledger.find((e) => e.id === withdrawalId && e.type === 'withdrawal')
    if (ledgerEntry) {
      ledgerEntry.status = status
    }
  }

  async approveWithdrawal(withdrawalId: string): Promise<WithdrawalResponse> {
    const withdrawal = this.requireWithdrawalForAdminAction(withdrawalId)

    if (withdrawal.status === 'confirmed' || withdrawal.status === 'approved') {
      return withdrawal
    }
    if (withdrawal.status === 'rejected' || withdrawal.status === 'failed') {
      throw new AppError(ErrorCode.CONFLICT, 409, `Withdrawal cannot be approved. Current status: ${withdrawal.status}`)
    }

    withdrawal.status = 'approved'
    withdrawal.processedAt = new Date().toISOString()
    this.updateLedgerStatus(withdrawalId, 'approved')

    const provider = getPaymentProvider('manual_admin')
    if (!provider.executePayout) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Payout execution is not supported')
    }

    const payout = await provider.executePayout({
      amountNgn: withdrawal.amountNgn,
      userId: this.withdrawalUserIds.get(withdrawal.id) ?? 'unknown',
      internalRef: withdrawal.id,
      bankAccount: withdrawal.bankAccount,
      rail: provider.name,
    })

    if (payout.status === 'confirmed') {
      return this.confirmWithdrawal(withdrawalId)
    }

    return this.failWithdrawal(withdrawalId, payout.providerStatus ?? 'Provider payout failed')
  }

  async rejectWithdrawal(withdrawalId: string, reason: string): Promise<WithdrawalResponse> {
    const withdrawal = this.requireWithdrawalForAdminAction(withdrawalId)

    if (withdrawal.status === 'rejected' || withdrawal.status === 'failed') {
      return withdrawal
    }
    if (withdrawal.status === 'confirmed') {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Withdrawal cannot be rejected after confirmation')
    }

    withdrawal.status = 'rejected'
    withdrawal.processedAt = new Date().toISOString()
    withdrawal.failureReason = reason
    this.updateLedgerStatus(withdrawalId, 'rejected')

    await this.releaseHeldFunds(withdrawalId, true)

    return withdrawal
  }

  async confirmWithdrawal(withdrawalId: string): Promise<WithdrawalResponse> {
    const withdrawal = this.requireWithdrawalForAdminAction(withdrawalId)

    if (withdrawal.status === 'confirmed') {
      return withdrawal
    }
    if (withdrawal.status === 'rejected' || withdrawal.status === 'failed') {
      throw new AppError(ErrorCode.CONFLICT, 409, `Withdrawal cannot be confirmed. Current status: ${withdrawal.status}`)
    }

    withdrawal.status = 'confirmed'
    withdrawal.processedAt = new Date().toISOString()
    this.updateLedgerStatus(withdrawalId, 'confirmed')

    await this.releaseHeldFunds(withdrawalId, false)

    return withdrawal
  }

  async failWithdrawal(withdrawalId: string, reason: string): Promise<WithdrawalResponse> {
    const withdrawal = this.requireWithdrawalForAdminAction(withdrawalId)

    if (withdrawal.status === 'failed') {
      return withdrawal
    }
    if (withdrawal.status === 'confirmed') {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Withdrawal cannot be failed after confirmation')
    }

    withdrawal.status = 'failed'
    withdrawal.processedAt = new Date().toISOString()
    withdrawal.failureReason = reason
    this.updateLedgerStatus(withdrawalId, 'failed')

    await this.releaseHeldFunds(withdrawalId, true)

    return withdrawal
  }

  private async releaseHeldFunds(withdrawalId: string, restoreToAvailable: boolean): Promise<void> {
    const withdrawal = this.requireWithdrawalForAdminAction(withdrawalId)
    const userId = this.withdrawalUserIds.get(withdrawalId)
    if (!userId) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Unable to resolve user for withdrawal')
    }

    const amount = withdrawal.amountNgn

    const bal = await this.getBalance(userId)
    if (bal.heldNgn < amount) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Insufficient held balance for withdrawal')
    }

    const updated: NgnBalanceResponse = {
      availableNgn: restoreToAvailable ? bal.availableNgn + amount : bal.availableNgn,
      heldNgn: Math.max(0, bal.heldNgn - amount),
      totalNgn: restoreToAvailable ? bal.totalNgn : bal.totalNgn - amount,
    }

    this.balances.set(userId, updated)
    return
  }

  async getWithdrawalHistory(userId: string, options: { limit?: number; cursor?: string } = {}): Promise<WithdrawalHistoryResponse> {
    logger.info('Getting withdrawal history', { userId, options })

    let entries = [...this.withdrawals].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    const limit = options.limit || 20
    entries = entries.slice(0, limit)

    return {
      entries,
      nextCursor: null
    }
  }

  /**
   * Credit NGN balance for a confirmed top-up deposit.
   * Idempotent by depositId - will not double-credit if already credited.
   * 
   * Policy: Allows negative available balance but logs a warning.
   * This allows the system to track chargebacks even if funds were already spent.
   */
  async creditTopUp(
    userId: string,
    depositId: string,
    amountNgn: number,
    reference: string
  ): Promise<{ credited: boolean; newBalance: NgnBalanceResponse }> {
    logger.info('Crediting top-up', { userId, depositId, amountNgn, reference })

    // Idempotency check - prevent double-crediting
    if (this.creditedDeposits.has(depositId)) {
      logger.warn('IDEMPOTENCY HIT: Deposit already credited to wallet, skipping', { depositId, userId })
      const balance = await this.getBalance(userId)
      return { credited: false, newBalance: balance }
    }

    // Get or initialize balance
    let balance = this.balances.get(userId)
    if (!balance) {
      balance = {
        availableNgn: 0,
        heldNgn: 0,
        totalNgn: 0
      }
      this.balances.set(userId, balance)
    }

    // Credit available balance
    const newAvailableNgn = balance.availableNgn + amountNgn
    const newTotalNgn = balance.totalNgn + amountNgn

    // Warn if balance would go negative (shouldn't happen for credits, but defensive)
    if (newAvailableNgn < 0) {
      logger.warn('Credit would result in negative balance', {
        userId,
        depositId,
        currentBalance: balance.availableNgn,
        creditAmount: amountNgn,
        newBalance: newAvailableNgn
      })
    }

    const updatedBalance: NgnBalanceResponse = {
      availableNgn: newAvailableNgn,
      heldNgn: balance.heldNgn,
      totalNgn: newTotalNgn
    }
    this.balances.set(userId, updatedBalance)

    // Mark as credited
    this.creditedDeposits.add(depositId)

    // Add ledger entry
    const ledgerEntry: NgnLedgerEntry = {
      id: depositId,
      type: 'topup_confirmed',
      amountNgn: amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference
    }
    this.ledger.unshift(ledgerEntry)

    logger.info('Top-up credited successfully', {
      userId,
      depositId,
      amountNgn,
      newAvailableNgn,
      newTotalNgn
    })

    return { credited: true, newBalance: updatedBalance }
  }

  /**
   * Debit NGN balance for a reversed/chargeback deposit.
   * Idempotent by depositId - will not double-debit if already reversed.
   * 
   * Policy: Allows negative available balance to track chargebacks.
   * In production, you may want to freeze accounts with negative balances.
   */
  async reverseTopUp(
    userId: string,
    depositId: string,
    amountNgn: number,
    reference: string
  ): Promise<{ reversed: boolean; newBalance: NgnBalanceResponse }> {
    logger.info('Reversing top-up', { userId, depositId, amountNgn, reference })

    // Check if deposit was previously credited
    if (!this.creditedDeposits.has(depositId)) {
      logger.warn('Attempting to reverse deposit that was never credited', {
        depositId,
        userId
      })
      const balance = await this.getBalance(userId)
      return { reversed: false, newBalance: balance }
    }

    const balance = await this.getBalance(userId)
    const newAvailableNgn = balance.availableNgn - amountNgn
    const newTotalNgn = balance.totalNgn - amountNgn

    // Warn if balance goes negative
    if (newAvailableNgn < 0) {
      logger.warn('Reversal results in negative balance', {
        userId,
        depositId,
        currentBalance: balance.availableNgn,
        reversalAmount: amountNgn,
        newBalance: newAvailableNgn,
        note: 'User may have already spent the funds. Consider freezing account.'
      })
    }

    const updatedBalance: NgnBalanceResponse = {
      availableNgn: newAvailableNgn,
      heldNgn: balance.heldNgn,
      totalNgn: newTotalNgn
    }
    this.balances.set(userId, updatedBalance)

    // Remove from credited set (allows re-credit if needed, though unlikely)
    this.creditedDeposits.delete(depositId)

    // Add ledger entry
    const ledgerEntry: NgnLedgerEntry = {
      id: `${depositId}-reversal`,
      type: 'topup_reversed',
      amountNgn: -amountNgn,
      status: 'reversed',
      timestamp: new Date().toISOString(),
      reference
    }
    this.ledger.unshift(ledgerEntry)

    logger.info('Top-up reversed successfully', {
      userId,
      depositId,
      amountNgn,
      newAvailableNgn,
      newTotalNgn
    })

    return { reversed: true, newBalance: updatedBalance }
  }

  /**
   * Reserve NGN for staking operation.
   * Moves funds from available to held and creates STAKE_RESERVE ledger entry.
   * Idempotent by canonical ref (externalRefSource:externalRef).
   */
  async reserveNgnForStaking(
    userId: string,
    externalRefSource: string,
    externalRef: string,
    amountNgn: number
  ): Promise<{ reserved: boolean; newBalance: NgnBalanceResponse }> {
    logger.info('Reserving NGN for staking', { userId, externalRefSource, externalRef, amountNgn })

    const canonicalRef = `${externalRefSource}:${externalRef}`

    // Idempotency check - prevent double-reservation
    const existing = this.stakingReservations.get(canonicalRef)
    if (existing) {
      logger.info('Staking reservation already exists, skipping', { canonicalRef, userId })
      const balance = await this.getBalance(userId)
      return { reserved: false, newBalance: balance }
    }

    // Get or initialize balance
    let balance = this.balances.get(userId)
    if (!balance) {
      balance = {
        availableNgn: 0,
        heldNgn: 0,
        totalNgn: 0
      }
      this.balances.set(userId, balance)
    }

    // Check sufficient available balance
    if (balance.availableNgn < amountNgn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        409,
        `Insufficient available balance. Available: ${balance.availableNgn}, Requested: ${amountNgn}`
      )
    }

    // Move from available to held
    const updatedBalance: NgnBalanceResponse = {
      availableNgn: balance.availableNgn - amountNgn,
      heldNgn: balance.heldNgn + amountNgn,
      totalNgn: balance.totalNgn
    }
    this.balances.set(userId, updatedBalance)

    // Track reservation
    this.stakingReservations.set(canonicalRef, {
      amountNgn,
      timestamp: new Date().toISOString()
    })

    // Add ledger entry
    const ledgerEntry: NgnLedgerEntry = {
      id: canonicalRef,
      type: 'stake_reserve',
      amountNgn: -amountNgn,
      status: 'pending',
      timestamp: new Date().toISOString(),
      reference: canonicalRef
    }
    this.ledger.unshift(ledgerEntry)

    logger.info('NGN reserved for staking', {
      userId,
      canonicalRef,
      amountNgn,
      newAvailableNgn: updatedBalance.availableNgn,
      newHeldNgn: updatedBalance.heldNgn
    })

    return { reserved: true, newBalance: updatedBalance }
  }

  /**
   * Release NGN reservation back to available balance.
   * Moves funds from held back to available and creates STAKE_RELEASE ledger entry.
   * Used when conversion fails or staking is cancelled.
   */
  async releaseNgnReserve(
    userId: string,
    externalRefSource: string,
    externalRef: string,
    amountNgn: number
  ): Promise<{ released: boolean; newBalance: NgnBalanceResponse }> {
    logger.info('Releasing NGN reservation', { userId, externalRefSource, externalRef, amountNgn })

    const canonicalRef = `${externalRefSource}:${externalRef}`

    // Check if reservation exists
    const reservation = this.stakingReservations.get(canonicalRef)
    if (!reservation) {
      logger.warn('Attempting to release non-existent reservation', { canonicalRef, userId })
      const balance = await this.getBalance(userId)
      return { released: false, newBalance: balance }
    }

    const balance = await this.getBalance(userId)

    // Move from held back to available
    const updatedBalance: NgnBalanceResponse = {
      availableNgn: balance.availableNgn + amountNgn,
      heldNgn: Math.max(0, balance.heldNgn - amountNgn),
      totalNgn: balance.totalNgn
    }
    this.balances.set(userId, updatedBalance)

    // Remove reservation tracking
    this.stakingReservations.delete(canonicalRef)

    // Add ledger entry
    const ledgerEntry: NgnLedgerEntry = {
      id: `${canonicalRef}-release`,
      type: 'stake_release',
      amountNgn: amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference: canonicalRef
    }
    this.ledger.unshift(ledgerEntry)

    // Update the original reserve entry status
    const reserveEntry = this.ledger.find(e => e.id === canonicalRef && e.type === 'stake_reserve')
    if (reserveEntry) {
      reserveEntry.status = 'failed'
    }

    logger.info('NGN reservation released', {
      userId,
      canonicalRef,
      amountNgn,
      newAvailableNgn: updatedBalance.availableNgn,
      newHeldNgn: updatedBalance.heldNgn
    })

    return { released: true, newBalance: updatedBalance }
  }

  /**
   * Debit NGN from held balance after successful conversion.
   * Creates CONVERSION_DEBIT ledger entry.
   * This is called after conversion completes successfully.
   */
  async debitNgnForConversion(
    userId: string,
    externalRefSource: string,
    externalRef: string,
    amountNgn: number
  ): Promise<{ debited: boolean; newBalance: NgnBalanceResponse }> {
    logger.info('Debiting NGN for conversion', { userId, externalRefSource, externalRef, amountNgn })

    const canonicalRef = `${externalRefSource}:${externalRef}`

    const balance = await this.getBalance(userId)

    // Verify sufficient held balance
    if (balance.heldNgn < amountNgn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        409,
        `Insufficient held balance. Held: ${balance.heldNgn}, Required: ${amountNgn}`
      )
    }

    // Reduce held and total
    const updatedBalance: NgnBalanceResponse = {
      availableNgn: balance.availableNgn,
      heldNgn: balance.heldNgn - amountNgn,
      totalNgn: balance.totalNgn - amountNgn
    }
    this.balances.set(userId, updatedBalance)

    // Remove reservation tracking (conversion completed)
    this.stakingReservations.delete(canonicalRef)

    // Add ledger entry
    const ledgerEntry: NgnLedgerEntry = {
      id: `${canonicalRef}-conversion`,
      type: 'conversion_debit',
      amountNgn: -amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference: canonicalRef
    }
    this.ledger.unshift(ledgerEntry)

    // Update the original reserve entry status
    const reserveEntry = this.ledger.find(e => e.id === canonicalRef && e.type === 'stake_reserve')
    if (reserveEntry) {
      reserveEntry.status = 'confirmed'
    }

    logger.info('NGN debited for conversion', {
      userId,
      canonicalRef,
      amountNgn,
      newHeldNgn: updatedBalance.heldNgn,
      newTotalNgn: updatedBalance.totalNgn
    })

    return { debited: true, newBalance: updatedBalance }
  }

  // Helper method for testing/demo - simulate withdrawal processing
  async processWithdrawal(withdrawalId: string, status: 'approved' | 'rejected' | 'confirmed' | 'failed', failureReason?: string): Promise<void> {
    const withdrawal = this.withdrawals.find(w => w.id === withdrawalId)
    if (!withdrawal) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Withdrawal not found')
    }

    withdrawal.status = status
    withdrawal.processedAt = new Date().toISOString()
    withdrawal.failureReason = failureReason || null

    // Update ledger entry
    const ledgerEntry = this.ledger.find(e => e.id === withdrawalId)
    if (ledgerEntry) {
      ledgerEntry.status = status
    }

    // If withdrawal is confirmed or failed, update held funds
    if (status === 'confirmed' || status === 'failed') {
      const balance = this.balances.get('demo-user')
      if (balance) {
        const updatedBalance: NgnBalanceResponse = {
          availableNgn: balance.availableNgn,
          heldNgn: Math.max(0, balance.heldNgn - withdrawal.amountNgn),
          totalNgn: status === 'confirmed' ? balance.totalNgn - withdrawal.amountNgn : balance.totalNgn
        }
        this.balances.set('demo-user', updatedBalance)
      }
    }

    logger.info('Withdrawal processed', { withdrawalId, status, failureReason })
  }
}
