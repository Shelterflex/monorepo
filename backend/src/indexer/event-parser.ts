import { IndexedReceipt } from './receipt-repository.js'
import { TxType } from '../outbox/types.js'

export interface RawReceiptEvent {
     ledger: number; txHash: string; contractId: string
     data: Record<string, unknown>
}

export function parseReceiptEvent(raw: RawReceiptEvent): IndexedReceipt {
     const d = raw.data
     return {
          txId: req(d, 'tx_id'), txType: req(d, 'tx_type') as TxType,
          dealId: req(d, 'deal_id'), amountUsdc: req(d, 'amount_usdc'),
          externalRefHash: req(d, 'external_ref'), // Contract stores as 'external_ref' (same as tx_id)
          listingId: opt(d, 'listing_id'), amountNgn: optNum(d, 'amount_ngn'),
          fxRate: optNum(d, 'fx_rate'), fxProvider: opt(d, 'fx_provider'),
          from: opt(d, 'from'), to: opt(d, 'to'), metadataHash: opt(d, 'metadata_hash'),
          ledger: raw.ledger, indexedAt: new Date(),
     }
}

/**
 * Attempt to parse a raw receipt event, returning null for malformed events
 * instead of throwing. Extra fields in the data object are safely ignored.
 */
export function tryParseReceiptEvent(raw: RawReceiptEvent): IndexedReceipt | null {
     try {
          if (!raw || !raw.data || typeof raw.data !== 'object') return null
          if (typeof raw.ledger !== 'number') return null
          return parseReceiptEvent(raw)
     } catch {
          return null
     }
}

function req(d: Record<string, unknown>, k: string): string {
     const v = d[k]; if (typeof v !== 'string' || !v) throw new Error(`Missing '${k}'`); return v
}
function opt(d: Record<string, unknown>, k: string) { return typeof d[k] === 'string' ? d[k] as string : undefined }
function optNum(d: Record<string, unknown>, k: string) { return typeof d[k] === 'number' ? d[k] as number : undefined }
