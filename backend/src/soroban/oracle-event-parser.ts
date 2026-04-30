// Oracle price feed types and event parser
// Validates: Requirements 7.1–7.6

export interface PriceResult {
    /** Price scaled by 1e7 (e.g., 1.5000000 USD = 15_000_000n) */
    price: bigint
    /** Unix seconds */
    timestamp: number
    feedId: string
    assetPair: string
}

export type OracleEventType =
    | 'price_updated'
    | 'fallback_used'
    | 'staleness_warning'
    | 'conservative_estimate_used'
    | 'no_price_available'

export interface OracleEvent {
    type: OracleEventType
    assetPair: string
    ledger: number
    payload: Record<string, unknown>
}

export interface OracleHealthStatus {
    assetPair: string
    activeFeedId: string | null
    lastUpdateTimestamp: number | null
    isStale: boolean
    lastEventType: OracleEventType | null
}

export class OraclePriceError extends Error {
    constructor(
        message: string,
        public readonly reason: 'stale' | 'unavailable' | 'no_feed_chain' | 'paused',
        public readonly assetPair: string,
    ) {
        super(message)
        this.name = 'OraclePriceError'
    }
}

export interface OracleClient {
    getPrice(assetPair: string): Promise<PriceResult>
    getPriceWithFallback(assetPair: string, fallbackChain: string[]): Promise<PriceResult>
    getOracleHealth(assetPair: string): Promise<OracleHealthStatus>
}

const ORACLE_PREFIX = 'oracle_price_feeds'

const VALID_EVENT_TYPES = new Set<string>([
    'price_updated',
    'fallback_used',
    'staleness_warning',
    'conservative_estimate_used',
    'no_price_available',
])

/**
 * Parse a raw Soroban event into a typed OracleEvent.
 * Returns null if the event is not an oracle_price_feeds event or is malformed.
 *
 * Raw event shape expected:
 *   { topic: [string, string, ...], data: unknown, ledger: number }
 */
export function parseOracleEvent(raw: unknown): OracleEvent | null {
    try {
        if (!raw || typeof raw !== 'object') return null
        const r = raw as Record<string, unknown>

        const topics = r['topic']
        if (!Array.isArray(topics) || topics.length < 2) return null

        // Requirement 7.5: first topic must equal "oracle_price_feeds"
        if (topics[0] !== ORACLE_PREFIX) return null

        const eventName = topics[1]
        if (typeof eventName !== 'string' || !VALID_EVENT_TYPES.has(eventName)) return null

        const ledger = typeof r['ledger'] === 'number' ? r['ledger'] : 0
        const data = r['data']

        const payload = buildPayload(eventName as OracleEventType, data)
        if (payload === null) return null

        const assetPair =
            typeof payload['assetPair'] === 'string' ? (payload['assetPair'] as string) : ''

        return {
            type: eventName as OracleEventType,
            assetPair,
            ledger,
            payload,
        }
    } catch {
        return null
    }
}

function buildPayload(
    type: OracleEventType,
    data: unknown,
): Record<string, unknown> | null {
    if (!Array.isArray(data)) return null

    switch (type) {
        case 'price_updated': {
            // data: [assetPair, feedId, price, timestamp]
            if (data.length < 4) return null
            return {
                assetPair: String(data[0]),
                feedId: String(data[1]),
                price: BigInt(data[2] as string | number | bigint),
                timestamp: Number(data[3]),
            }
        }
        case 'fallback_used': {
            // data: [assetPair, feedIdUsed, skipped[]]
            if (data.length < 3) return null
            return {
                assetPair: String(data[0]),
                feedIdUsed: String(data[1]),
                skipped: Array.isArray(data[2]) ? (data[2] as unknown[]).map(String) : [],
            }
        }
        case 'staleness_warning': {
            // data: [assetPair, feedId, ageSeconds, limit]
            if (data.length < 4) return null
            return {
                assetPair: String(data[0]),
                feedId: String(data[1]),
                ageSeconds: Number(data[2]),
                limit: Number(data[3]),
            }
        }
        case 'conservative_estimate_used': {
            // data: [assetPair, price]
            if (data.length < 2) return null
            return {
                assetPair: String(data[0]),
                price: BigInt(data[1] as string | number | bigint),
            }
        }
        case 'no_price_available': {
            // data: [assetPair]
            if (data.length < 1) return null
            return { assetPair: String(data[0]) }
        }
        default:
            return null
    }
}
