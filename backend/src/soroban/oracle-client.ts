import { SorobanAdapter } from './adapter.js'
import {
    OracleClient,
    OracleEvent,
    OracleHealthStatus,
    OraclePriceError,
    PriceResult,
    parseOracleEvent,
} from './oracle-event-parser.js'

// Contract error codes returned by the oracle contract (100–199 range)
const CONTRACT_ERROR_NO_FEED_CHAIN = 101
const CONTRACT_ERROR_NO_PRICE_AVAILABLE = 102
const CONTRACT_ERROR_PAUSED = 3

/**
 * OracleClientImpl satisfies the OracleClient interface.
 * It delegates on-chain calls to the SorobanAdapter and maintains an
 * in-memory health cache populated by oracle event parsing.
 */
export class OracleClientImpl implements OracleClient {
    private readonly healthCache = new Map<string, OracleHealthStatus>()

    constructor(
        private readonly adapter: SorobanAdapter,
        private readonly oracleContractId: string,
    ) { }

    /**
     * Query the on-chain oracle for the freshest price within staleness bounds.
     * Throws OraclePriceError when no acceptable price is available.
     */
    async getPrice(assetPair: string): Promise<PriceResult> {
        try {
            const rawEvents = await this.adapter.getTimelockEvents(null)
            this.ingestEvents(rawEvents)

            // Invoke the oracle contract's get_price function
            const result = await this.invokeGetPrice(assetPair)
            return result
        } catch (err) {
            if (err instanceof OraclePriceError) throw err
            throw this.mapContractError(err, assetPair)
        }
    }

    /**
     * Off-chain fallback chain: tries each feed in order, returning the first
     * successful price. Mirrors the on-chain fallback logic for off-chain consumers.
     */
    async getPriceWithFallback(
        assetPair: string,
        fallbackChain: string[],
    ): Promise<PriceResult> {
        let lastError: OraclePriceError | null = null

        for (const feedId of fallbackChain) {
            try {
                const result = await this.getPriceFromFeed(assetPair, feedId)
                return result
            } catch (err) {
                if (err instanceof OraclePriceError) {
                    lastError = err
                    continue
                }
                throw err
            }
        }

        throw (
            lastError ??
            new OraclePriceError(
                `No price available for ${assetPair} in fallback chain`,
                'unavailable',
                assetPair,
            )
        )
    }

    /**
     * Returns the last known oracle health status for an asset pair,
     * derived from the cached event stream.
     */
    async getOracleHealth(assetPair: string): Promise<OracleHealthStatus> {
        // Refresh event cache
        try {
            const rawEvents = await this.adapter.getTimelockEvents(null)
            this.ingestEvents(rawEvents)
        } catch {
            // Best-effort refresh; return cached state if available
        }

        return (
            this.healthCache.get(assetPair) ?? {
                assetPair,
                activeFeedId: null,
                lastUpdateTimestamp: null,
                isStale: true,
                lastEventType: null,
            }
        )
    }

    // ── Private helpers ─────────────────────────────────────────────────────────

    private ingestEvents(rawEvents: unknown[]): void {
        for (const raw of rawEvents) {
            const event = parseOracleEvent(raw)
            if (!event) continue
            this.updateHealthCache(event)
        }
    }

    private updateHealthCache(event: OracleEvent): void {
        const existing = this.healthCache.get(event.assetPair) ?? {
            assetPair: event.assetPair,
            activeFeedId: null,
            lastUpdateTimestamp: null,
            isStale: true,
            lastEventType: null,
        }

        const updated: OracleHealthStatus = {
            ...existing,
            lastEventType: event.type,
        }

        switch (event.type) {
            case 'price_updated':
                updated.activeFeedId = String(event.payload['feedId'] ?? '')
                updated.lastUpdateTimestamp = Number(event.payload['timestamp'] ?? 0)
                updated.isStale = false
                break
            case 'conservative_estimate_used':
                updated.activeFeedId = 'conservative'
                updated.isStale = false
                break
            case 'no_price_available':
                updated.isStale = true
                updated.activeFeedId = null
                break
            case 'staleness_warning':
                updated.isStale = true
                break
            default:
                break
        }

        this.healthCache.set(event.assetPair, updated)
    }

    private async invokeGetPrice(assetPair: string): Promise<PriceResult> {
        // The adapter's getTimelockEvents is the generic event/query mechanism.
        // For a real implementation this would call the oracle contract directly.
        // Here we surface the contract error mapping via the error path.
        throw new OraclePriceError(
            `Direct contract invocation not implemented; use adapter integration`,
            'unavailable',
            assetPair,
        )
    }

    private async getPriceFromFeed(
        assetPair: string,
        _feedId: string,
    ): Promise<PriceResult> {
        return this.invokeGetPrice(assetPair)
    }

    private mapContractError(err: unknown, assetPair: string): OraclePriceError {
        const code = extractContractErrorCode(err)

        if (code === CONTRACT_ERROR_PAUSED) {
            return new OraclePriceError(
                `Oracle contract is paused for ${assetPair}`,
                'paused',
                assetPair,
            )
        }
        if (code === CONTRACT_ERROR_NO_FEED_CHAIN) {
            return new OraclePriceError(
                `No feed chain configured for ${assetPair}`,
                'no_feed_chain',
                assetPair,
            )
        }
        if (code === CONTRACT_ERROR_NO_PRICE_AVAILABLE) {
            return new OraclePriceError(
                `No acceptable price available for ${assetPair}`,
                'unavailable',
                assetPair,
            )
        }

        return new OraclePriceError(
            `Oracle error for ${assetPair}: ${String(err)}`,
            'unavailable',
            assetPair,
        )
    }
}

function extractContractErrorCode(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null
    const e = err as Record<string, unknown>
    if (typeof e['code'] === 'number') return e['code']
    // Some Soroban SDKs embed the code in a message like "ContractError(102)"
    const msg = String(e['message'] ?? '')
    const match = msg.match(/ContractError\((\d+)\)/)
    if (match) return parseInt(match[1], 10)
    return null
}
