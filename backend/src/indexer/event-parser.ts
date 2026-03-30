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
export interface TimelockEvent {
    txHash: string;
    target?: string;
    functionName?: string;
    args?: any[];
    delay?: number;
    ledger: number;
    type: 'queued' | 'executed' | 'cancelled';
}

export function parseTimelockEvent(raw: any): TimelockEvent | null {
    try {
        const topics = raw.topic || [];
        if (topics[0] !== 'governance') return null;

        const type = topics[1]; // e.g., "queued", "executed", "cancelled"
        const d = raw.data;

        if (type === 'queued' && Array.isArray(d) && d.length >= 5) {
            return {
                type: 'queued',
                txHash: d[0], // Internal hash
                target: d[1],
                functionName: d[2],
                args: d[3],
                delay: d[4], // This is eta
                ledger: raw.ledger,
            };
        } else if ((type === 'executed' || type === 'cancelled') && typeof d === 'string') {
            return {
                type: type,
                txHash: d, // Single value
                ledger: raw.ledger,
            };
        }
        return null;
    } catch (err) {
        console.error("Failed to parse Timelock event:", err);
        return null;
    }
}
