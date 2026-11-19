import type { Env } from '../schemas/env.js'
import { logger } from '../utils/logger.js'
import {
  FallbackConversionProvider,
  HttpConversionProvider,
  StubConversionProvider,
  type ConversionProvider,
} from './conversionProvider.js'

/**
 * Builds the NGN→USDC conversion provider from environment.
 * - `stub`: deterministic local/test (FX_RATE_NGN_PER_USDC only).
 * - `http`: live JSON rate endpoint (CONVERSION_RATE_URL required).
 * - `fallback`: try HTTP when URL is set; on any failure use stub (deterministic); if URL unset, stub only.
 */
export function createConversionProviderFromEnv(e: Env): ConversionProvider {
  const stub = new StubConversionProvider(e.FX_RATE_NGN_PER_USDC)

  if (e.CONVERSION_PROVIDER === 'stub') {
    return stub
  }

  if (e.CONVERSION_PROVIDER === 'http') {
    return new HttpConversionProvider({
      rateUrl: e.CONVERSION_RATE_URL!,
      apiKey: e.CONVERSION_RATE_API_KEY,
      timeoutMs: e.CONVERSION_HTTP_TIMEOUT_MS,
      minRate: e.CONVERSION_RATE_MIN,
      maxRate: e.CONVERSION_RATE_MAX,
    })
  }

  // fallback
  if (!e.CONVERSION_RATE_URL) {
    logger.info('CONVERSION_PROVIDER=fallback without CONVERSION_RATE_URL; using stub-only conversion')
    return stub
  }

  const http = new HttpConversionProvider({
    rateUrl: e.CONVERSION_RATE_URL,
    apiKey: e.CONVERSION_RATE_API_KEY,
    timeoutMs: e.CONVERSION_HTTP_TIMEOUT_MS,
    minRate: e.CONVERSION_RATE_MIN,
    maxRate: e.CONVERSION_RATE_MAX,
  })

  return new FallbackConversionProvider(http, stub)
}
