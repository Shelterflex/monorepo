import { randomUUID } from 'node:crypto'
import {
  LedgerEntry,
  LedgerEntryType,
  NgnWallet,
  WalletBalance,
} from '../models/ngnWallet.js'
import {
  type WithdrawalRequest,
  type WithdrawalResponse,
  type WithdrawalHistoryResponse,
  type NgnLedgerResponse,
} from '../schemas/ngnWallet.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

/**
 * Returns the available/held balance deltas for a ledger entry.
 *
 * amountNgn is the positive magnitude for all types except ADJUSTMENT,
 * which can be signed. The table below documents each effect:
 *
 *   TOPUP_PENDING        held   +amount
 *   TOPUP_CONFIRMED      avail  +amount
 *   TOPUP_REVERSED       avail  -amount
 *   STAKE_RESERVE        avail  -amount  held  +amount
 *   STAKE_RELEASE        avail  +amount  held  -amount
 *   CONVERSION_DEBIT     held   -amount
 *   WITHDRAWAL_PENDING   avail  -amount  held  +amount
 *   WITHDRAWAL_CONFIRMED held   -amount
 *   WITHDRAWAL_FAILED    avail  +amount  held  -amount
 *   ADJUSTMENT           avail  +/-amount (signed)
 */
export function computeEffect(
  type: LedgerEntryType,
  amountNgn: number,
): { availableDelta: number; heldDelta: number } {
  switch (type) {
    case LedgerEntryType.TOPUP_PENDING:
      return { availableDelta: 0, heldDelta: +amountNgn }
    case LedgerEntryType.TOPUP_CONFIRMED:
      return { availableDelta: +amountNgn, heldDelta: 0 }
    case LedgerEntryType.TOPUP_REVERSED:
      return { availableDelta: -amountNgn, heldDelta: 0 }
    case LedgerEntryType.STAKE_RESERVE:
      return { availableDelta: -amountNgn, heldDelta: +amountNgn }
    case LedgerEntryType.STAKE_RELEASE:
      return { availableDelta: +amountNgn, heldDelta: -amountNgn }
    case LedgerEntryType.CONVERSION_DEBIT:
      return { availableDelta: 0, heldDelta: -amountNgn }
    case LedgerEntryType.WITHDRAWAL_PENDING:
      return { availableDelta: -amountNgn, heldDelta: +amountNgn }
    case LedgerEntryType.WITHDRAWAL_CONFIRMED:
      return { availableDelta: 0, heldDelta: -amountNgn }
    case LedgerEntryType.WITHDRAWAL_FAILED:
      return { availableDelta: +amountNgn, heldDelta: -amountNgn }
    case LedgerEntryType.ADJUSTMENT:
      return { availableDelta: amountNgn, heldDelta: 0 }
  }
}

/** Simple per-key in-memory mutex for serialising wallet writes (MVP). */
class AsyncMutex {
  private locked = false
  private readonly queue: Array<() => void> = []

  acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true
          resolve(() => this.release())
        } else {
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  private release() {
    this.locked = false
    this.queue.shift()?.()
  }
}

interface WithdrawalRecord {
  id: string
  walletId: string
  amountNgn: number
  bankAccount: { accountNumber: string; accountName: string; bankName: string }
  reference: string
  status: WithdrawalResponse['status']
  createdAt: Date
  processedAt: Date | null
  failureReason: string | null
}

export class NgnWalletService {
  /** userId → NgnWallet */
  private readonly wallets = new Map<string, NgnWallet>()
  /** walletId → ordered ledger entries */
  private readonly ledgers = new Map<string, LedgerEntry[]>()
  /** walletId → mutex */
  private readonly mutexes = new Map<string, AsyncMutex>()
  /** withdrawalId → record */
  private readonly withdrawals = new Map<string, WithdrawalRecord>()

  // ── wallet lifecycle ────────────────────────────────────────────────────────

  private getOrCreateWallet(userId: string): NgnWallet {
    let wallet = this.wallets.get(userId)
    if (!wallet) {
      wallet = { walletId: randomUUID(), userId, currency: 'NGN', createdAt: new Date() }
      this.wallets.set(userId, wallet)
      this.ledgers.set(wallet.walletId, [])
      this.mutexes.set(wallet.walletId, new AsyncMutex())
    }
    return wallet
  }

  private getMutex(walletId: string): AsyncMutex {
    let m = this.mutexes.get(walletId)
    if (!m) {
      m = new AsyncMutex()
      this.mutexes.set(walletId, m)
    }
    return m
  }

  // ── balance computation ─────────────────────────────────────────────────────

  /** Computes balance deterministically from ledger entries. No stored fields. */
  getWalletBalance(userId: string): WalletBalance {
    const wallet = this.getOrCreateWallet(userId)
    const entries = this.ledgers.get(wallet.walletId) ?? []

    let availableBalanceNgn = 0
    let heldBalanceNgn = 0

    for (const entry of entries) {
      const { availableDelta, heldDelta } = computeEffect(entry.type, entry.amountNgn)
      availableBalanceNgn += availableDelta
      heldBalanceNgn += heldDelta
    }

    return { availableBalanceNgn, heldBalanceNgn, totalBalanceNgn: availableBalanceNgn + heldBalanceNgn }
  }

  /** Public alias used by the route handler. */
  async getBalance(userId: string): Promise<WalletBalance> {
    return this.getWalletBalance(userId)
  }

  // ── ledger writes ───────────────────────────────────────────────────────────

  /** Appends a ledger entry under the wallet mutex. */
  async addEntry(
    userId: string,
    type: LedgerEntryType,
    amountNgn: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<LedgerEntry> {
    const wallet = this.getOrCreateWallet(userId)
    const release = await this.getMutex(wallet.walletId).acquire()
    try {
      const entry: LedgerEntry = {
        entryId: randomUUID(),
        walletId: wallet.walletId,
        type,
        amountNgn,
        referenceType,
        referenceId,
        createdAt: new Date(),
      }
      this.ledgers.get(wallet.walletId)!.push(entry)
      logger.debug('Ledger entry added', { userId, type, amountNgn, entryId: entry.entryId })
      return entry
    } finally {
      release()
    }
  }

  // ── ledger reads ────────────────────────────────────────────────────────────

  async getLedger(
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<NgnLedgerResponse> {
    const wallet = this.getOrCreateWallet(userId)
    const sorted = [...(this.ledgers.get(wallet.walletId) ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )

    const limit = options.limit ?? 20
    const page = sorted.slice(0, limit)

    return {
      entries: page.map(e => ({
        id: e.entryId,
        type: e.type,
        amountNgn: e.amountNgn,
        status: 'confirmed' as const,
        timestamp: e.createdAt.toISOString(),
        reference: e.referenceId ?? null,
      })),
      nextCursor: null,
    }
  }

  // ── withdrawals ─────────────────────────────────────────────────────────────

  async initiateWithdrawal(userId: string, request: WithdrawalRequest): Promise<WithdrawalResponse> {
    logger.info('Initiating withdrawal', { userId, amount: request.amountNgn })

    const balance = this.getWalletBalance(userId)
    if (request.amountNgn > balance.availableBalanceNgn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `Insufficient balance. Available: ${balance.availableBalanceNgn}, Requested: ${request.amountNgn}`,
      )
    }

    const withdrawalId = `wd-${randomUUID()}`
    const reference = `WD-${Date.now()}`
    const now = new Date()

    await this.addEntry(userId, LedgerEntryType.WITHDRAWAL_PENDING, request.amountNgn, 'withdrawal', withdrawalId)

    const wallet = this.getOrCreateWallet(userId)
    const record: WithdrawalRecord = {
      id: withdrawalId,
      walletId: wallet.walletId,
      amountNgn: request.amountNgn,
      bankAccount: request.bankAccount,
      reference,
      status: 'pending',
      createdAt: now,
      processedAt: null,
      failureReason: null,
    }
    this.withdrawals.set(withdrawalId, record)

    logger.info('Withdrawal initiated', { userId, withdrawalId, amount: request.amountNgn })

    return {
      id: withdrawalId,
      amountNgn: request.amountNgn,
      status: 'pending',
      bankAccount: request.bankAccount,
      reference,
      createdAt: now.toISOString(),
      processedAt: null,
      failureReason: null,
    }
  }

  async getWithdrawalHistory(
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<WithdrawalHistoryResponse> {
    const wallet = this.getOrCreateWallet(userId)

    const records = [...this.withdrawals.values()]
      .filter(w => w.walletId === wallet.walletId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const limit = options.limit ?? 20
    const page = records.slice(0, limit)

    return {
      entries: page.map(w => ({
        id: w.id,
        amountNgn: w.amountNgn,
        status: w.status,
        bankAccount: w.bankAccount,
        reference: w.reference,
        createdAt: w.createdAt.toISOString(),
        processedAt: w.processedAt?.toISOString() ?? null,
        failureReason: w.failureReason,
      })),
      nextCursor: null,
    }
  }

  /** Process a pending withdrawal (used by admin/webhook handlers). */
  async processWithdrawal(
    withdrawalId: string,
    status: 'approved' | 'rejected' | 'confirmed' | 'failed',
    failureReason?: string,
  ): Promise<void> {
    const record = this.withdrawals.get(withdrawalId)
    if (!record) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Withdrawal not found')
    }

    // Find the userId for this wallet
    const userId = [...this.wallets.entries()].find(([, w]) => w.walletId === record.walletId)?.[0]
    if (!userId) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Wallet owner not found')
    }

    if (status === 'confirmed') {
      await this.addEntry(userId, LedgerEntryType.WITHDRAWAL_CONFIRMED, record.amountNgn, 'withdrawal', withdrawalId)
    } else if (status === 'failed' || status === 'rejected') {
      await this.addEntry(userId, LedgerEntryType.WITHDRAWAL_FAILED, record.amountNgn, 'withdrawal', withdrawalId)
    }

    record.status = status
    record.processedAt = new Date()
    record.failureReason = failureReason ?? null

    logger.info('Withdrawal processed', { withdrawalId, status })
  }
}
