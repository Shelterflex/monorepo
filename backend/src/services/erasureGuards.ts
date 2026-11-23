/**
 * Blockers for account erasure (#2053). Erasure is refused while the account has:
 *   - an active or at-risk deal, as tenant or landlord (`active_deal`)
 *   - a withdrawal that is pending, approved or processing (`pending_withdrawal`)
 *   - a non-zero NGN wallet balance (`wallet_balance`)
 *   - an open payment dispute (`open_dispute`)
 *
 * The checks fail closed. If the balance or dispute data cannot be read, the error
 * propagates and the erasure does not go ahead.
 */

import { DealStatus } from '../models/deal.js'
import { dealStore } from '../models/dealStore.js'
import { ngnWithdrawalStore, type NgnWithdrawalStatus } from '../models/ngnWithdrawalStore.js'
import { paymentDisputeRepository } from '../repositories/PaymentDisputeRepository.js'

export type ErasureBlocker = 'active_deal' | 'pending_withdrawal' | 'wallet_balance' | 'open_dispute'

export interface WalletBalanceSnapshot {
  availableNgn: number
  heldNgn: number
  totalNgn: number
}

export type WalletBalanceProvider = (userId: string) => Promise<WalletBalanceSnapshot>

let balanceProvider: WalletBalanceProvider | null = null

/** Wired from app.ts, where the NGN wallet service is created. */
export function setErasureBalanceProvider(provider: WalletBalanceProvider | null): void {
  balanceProvider = provider
}

const IN_FLIGHT_DEAL_STATUSES: readonly DealStatus[] = [DealStatus.ACTIVE, DealStatus.AT_RISK]
const IN_FLIGHT_WITHDRAWAL_STATUSES: readonly NgnWithdrawalStatus[] = ['pending', 'approved', 'processing']
const OPEN_DISPUTE_STATUSES: readonly string[] = ['pending', 'under_review']

export async function findErasureBlockers(userId: string): Promise<ErasureBlocker[]> {
  const blockers = new Set<ErasureBlocker>()

  for (const status of IN_FLIGHT_DEAL_STATUSES) {
    const asTenant = await dealStore.findMany({ tenantId: userId, status, pageSize: 1 })
    const asLandlord = await dealStore.findMany({ landlordId: userId, status, pageSize: 1 })
    if (asTenant.total > 0 || asLandlord.total > 0) blockers.add('active_deal')
  }

  for (const status of IN_FLIGHT_WITHDRAWAL_STATUSES) {
    const page = await ngnWithdrawalStore.list({ userId, status, limit: 1 })
    if (page.items.length > 0) blockers.add('pending_withdrawal')
  }

  if (!balanceProvider) {
    throw new Error('Wallet balance provider is not configured for account erasure')
  }
  const balance = await balanceProvider(userId)
  if (balance.availableNgn !== 0 || balance.heldNgn !== 0 || balance.totalNgn !== 0) {
    blockers.add('wallet_balance')
  }

  const disputes = await paymentDisputeRepository.findByUserId(userId)
  if (disputes.some((dispute) => OPEN_DISPUTE_STATUSES.includes(dispute.status))) {
    blockers.add('open_dispute')
  }

  return [...blockers]
}
