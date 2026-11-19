import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConversionProviderError,
  FallbackConversionProvider,
  HttpConversionProvider,
  StubConversionProvider,
  parseFxRateFromJson,
} from './conversionProvider.js'
import { logger } from '../utils/logger.js'

describe('parseFxRateFromJson', () => {
  it('reads fxRateNgnPerUsdc', () => {
    expect(parseFxRateFromJson({ fxRateNgnPerUsdc: 1500 })).toBe(1500)
  })

  it('reads ngnPerUsdc', () => {
    expect(parseFxRateFromJson({ ngnPerUsdc: 1550.25 })).toBe(1550.25)
  })

  it('reads rate', () => {
    expect(parseFxRateFromJson({ rate: 1600 })).toBe(1600)
  })

  it('coerces string numbers', () => {
    expect(parseFxRateFromJson({ fxRateNgnPerUsdc: '1620' })).toBe(1620)
  })

  it('rejects non-object', () => {
    expect(() => parseFxRateFromJson(null)).toThrow(ConversionProviderError)
    expect(() => parseFxRateFromJson(null)).toThrow(/JSON object/)
  })

  it('rejects missing or invalid rate', () => {
    expect(() => parseFxRateFromJson({})).toThrow(/positive finite/)
    expect(() => parseFxRateFromJson({ fxRateNgnPerUsdc: 0 })).toThrow(/positive finite/)
    expect(() => parseFxRateFromJson({ fxRateNgnPerUsdc: -1 })).toThrow(/positive finite/)
    expect(() => parseFxRateFromJson({ fxRateNgnPerUsdc: Number.NaN })).toThrow(/positive finite/)
  })
})

describe('HttpConversionProvider', () => {
  const baseOpts = {
    rateUrl: 'https://rates.test/api/ngn-usdc',
    timeoutMs: 5_000,
    minRate: 100,
    maxRate: 10_000,
  }

  it('converts using JSON rate and default providerRef', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ fxRateNgnPerUsdc: 1600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const p = new HttpConversionProvider({ ...baseOpts, fetchFn })
    const out = await p.convertNgnToUsdc({
      amountNgn: 1600,
      userId: 'u1',
      depositId: 'dep-a',
    })
    expect(out.fxRateNgnPerUsdc).toBe(1600)
    expect(out.amountUsdc).toBe('1.000000')
    expect(out.providerRef).toBe('http:dep-a:1600')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://rates.test/api/ngn-usdc',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('uses providerRef from JSON when present', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ fxRateNgnPerUsdc: 1500, providerRef: 'quote-xyz-99' }),
        { status: 200 },
      ),
    )
    const p = new HttpConversionProvider({ ...baseOpts, fetchFn })
    const out = await p.convertNgnToUsdc({
      amountNgn: 3000,
      userId: 'u1',
      depositId: 'dep-b',
    })
    expect(out.providerRef).toBe('quote-xyz-99')
    expect(out.amountUsdc).toBe('2.000000')
  })

  it('sends Bearer when apiKey set', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ fxRateNgnPerUsdc: 1600 }), { status: 200 }),
    )
    const p = new HttpConversionProvider({ ...baseOpts, apiKey: 'secret', fetchFn })
    await p.convertNgnToUsdc({ amountNgn: 1600, userId: 'u', depositId: 'd' })
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer secret',
    })
  })

  it('rejects rate outside bounds', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ fxRateNgnPerUsdc: 50 }), { status: 200 }),
    )
    const p = new HttpConversionProvider({ ...baseOpts, fetchFn })
    await expect(p.convertNgnToUsdc({ amountNgn: 100, userId: 'u', depositId: 'd' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('maps non-ok HTTP to INVALID_RESPONSE or NETWORK', async () => {
    const fetch404 = vi.fn().mockResolvedValue(new Response('gone', { status: 404 }))
    const p404 = new HttpConversionProvider({ ...baseOpts, fetchFn: fetch404 })
    const e404 = await p404.convertNgnToUsdc({ amountNgn: 100, userId: 'u', depositId: 'd' }).catch((x) => x)
    expect(e404).toBeInstanceOf(ConversionProviderError)
    expect((e404 as ConversionProviderError).code).toBe('INVALID_RESPONSE')

    const fetch502 = vi.fn().mockResolvedValue(new Response('bad', { status: 502 }))
    const p502 = new HttpConversionProvider({ ...baseOpts, fetchFn: fetch502 })
    const e502 = await p502.convertNgnToUsdc({ amountNgn: 100, userId: 'u', depositId: 'd' }).catch((x) => x)
    expect((e502 as ConversionProviderError).code).toBe('NETWORK')
  })

  it('rejects invalid JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }))
    const p = new HttpConversionProvider({ ...baseOpts, fetchFn })
    await expect(p.convertNgnToUsdc({ amountNgn: 100, userId: 'u', depositId: 'd' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('maps fetch failure to NETWORK', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const p = new HttpConversionProvider({ ...baseOpts, fetchFn })
    await expect(p.convertNgnToUsdc({ amountNgn: 100, userId: 'u', depositId: 'd' })).rejects.toMatchObject({
      code: 'NETWORK',
    })
  })

  it('validates amountNgn', async () => {
    const p = new HttpConversionProvider({ ...baseOpts, fetchFn: vi.fn() })
    await expect(p.convertNgnToUsdc({ amountNgn: 0, userId: 'u', depositId: 'd' })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })
})

describe('FallbackConversionProvider', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns primary result when primary succeeds', async () => {
    const primary = new StubConversionProvider(1700)
    const fallback = new StubConversionProvider(1600)
    const p = new FallbackConversionProvider(primary, fallback)
    const out = await p.convertNgnToUsdc({ amountNgn: 1700, userId: 'u', depositId: 'dep-1' })
    expect(out.fxRateNgnPerUsdc).toBe(1700)
    expect(out.providerRef).toBe('stub:dep-1')
  })

  it('uses stub and prefixes providerRef when primary fails', async () => {
    const primary = {
      async convertNgnToUsdc() {
        throw new ConversionProviderError('upstream down', 'NETWORK')
      },
    }
    const stub = new StubConversionProvider(1600)
    const p = new FallbackConversionProvider(primary, stub)
    const out = await p.convertNgnToUsdc({ amountNgn: 3200, userId: 'u', depositId: 'dep-2' })
    expect(out.fxRateNgnPerUsdc).toBe(1600)
    expect(out.amountUsdc).toBe('2.000000')
    expect(out.providerRef).toBe('fallback:stub:dep-2')
    expect(logger.warn).toHaveBeenCalled()
  })
})

const FRESH_NGN_USDC_FEED: PriceFeed = {
  pair: 'NGN_USDC',
  price: '16000000000', // 1600.0000000 scaled by 10^7
  decimals: 7,
  updatedAt: 1_000,
  sequence: 5,
}


describe('StubConversionProvider', () => {
  it('still matches legacy deterministic output', async () => {
    const p = new StubConversionProvider(1600)
    const out = await p.convertNgnToUsdc({ amountNgn: 1600, userId: 'u', depositId: 'dep-x' })
    expect(out).toEqual({
      amountUsdc: '1.000000',
      fxRateNgnPerUsdc: 1600,
      providerRef: 'stub:dep-x',
    })
  })
})
