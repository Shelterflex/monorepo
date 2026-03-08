/**
 * NGN Wallet and double-entry ledger model types.
 *
 * Sign rules for LedgerEntry.amountNgn:
 *   - ADJUSTMENT: signed (positive = credit, negative = debit to available)
 *   - All other types: positive magnitude; the bucket effect is determined by
 *     computeEffect() in ngnWalletService.
 *
 * Bucket effects per entry type:
 *   TOPUP_PENDING        → held +amount
 *   TOPUP_CONFIRMED      → available +amount
 *   TOPUP_REVERSED       → available -amount
 *   STAKE_RESERVE        → available -amount, held +amount
 *   STAKE_RELEASE        → available +amount, held -amount
 *   CONVERSION_DEBIT     → held -amount
 *   WITHDRAWAL_PENDING   → available -amount, held +amount
 *   WITHDRAWAL_CONFIRMED → held -amount
 *   WITHDRAWAL_FAILED    → available +amount, held -amount
 *   ADJUSTMENT           → available +/-amount (signed)
 */

export const LedgerEntryType = {
  TOPUP_PENDING: 'TOPUP_PENDING',
  TOPUP_CONFIRMED: 'TOPUP_CONFIRMED',
  TOPUP_REVERSED: 'TOPUP_REVERSED',
  STAKE_RESERVE: 'STAKE_RESERVE',
  STAKE_RELEASE: 'STAKE_RELEASE',
  CONVERSION_DEBIT: 'CONVERSION_DEBIT',
  WITHDRAWAL_PENDING: 'WITHDRAWAL_PENDING',
  WITHDRAWAL_CONFIRMED: 'WITHDRAWAL_CONFIRMED',
  WITHDRAWAL_FAILED: 'WITHDRAWAL_FAILED',
  ADJUSTMENT: 'ADJUSTMENT',
} as const

export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType]

export interface NgnWallet {
  walletId: string
  userId: string
  currency: 'NGN'
  createdAt: Date
}

export interface LedgerEntry {
  entryId: string
  walletId: string
  type: LedgerEntryType
  /** Positive magnitude for all types except ADJUSTMENT, which may be negative. */
  amountNgn: number
  referenceType?: string
  referenceId?: string
  createdAt: Date
}

export interface WalletBalance {
  availableBalanceNgn: number
  heldBalanceNgn: number
  totalBalanceNgn: number
}
