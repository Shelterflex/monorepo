import { logger } from '../utils/logger.js'

export interface ConvertNgnToUsdcInput {
  amountNgn: number
  userId: string
  depositId: string
}

export interface ConvertNgnToUsdcOutput {
  amountUsdc: string
  fxRateNgnPerUsdc: number
  providerRef: string
}

export interface ConversionRateQuote {
  /** NGN per 1 USDC */
  rate: number
  source: string
  /** When the rate HTTP response includes providerRef, pass it through to conversions */
  providerRef?: string
}

export interface ConversionProvider {
  convertNgnToUsdc(input: ConvertNgnToUsdcInput): Promise<ConvertNgnToUsdcOutput>
  getRate(): Promise<ConversionRateQuote>
}

export type ConversionProviderErrorCode = 'INVALID_RESPONSE' | 'NETWORK' | 'VALIDATION'

export class ConversionProviderError extends Error {
  readonly code: ConversionProviderErrorCode

  constructor(message: string, code: ConversionProviderErrorCode) {
    super(message)
    this.name = 'ConversionProviderError'
    this.code = code
  }
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function toUsdcDecimalString(amountUsdc: number): string {
  if (!Number.isFinite(amountUsdc)) {
    throw new Error('Invalid USDC amount')
  }
  return amountUsdc.toFixed(6)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/**
 * Parse FX rate from a JSON object. Supports `fxRateNgnPerUsdc`, `ngnPerUsdc`, or `rate`.
 */
export function parseFxRateFromJson(body: unknown): number {
  const rec = asRecord(body)
  if (!rec) {
    throw new ConversionProviderError('Conversion rate response must be a JSON object', 'INVALID_RESPONSE')
  }
  const raw =
    rec.fxRateNgnPerUsdc ?? rec.ngnPerUsdc ?? rec.rate
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConversionProviderError('Conversion rate must be a positive finite number', 'INVALID_RESPONSE')
  }
  return n
}

function parseOptionalProviderRef(body: unknown): string | undefined {
  const rec = asRecord(body)
  const v = rec?.providerRef
  if (typeof v === 'string' && v.trim().length > 0) {
    return v.trim().slice(0, 512)
  }
  return undefined
}

export type HttpConversionProviderOptions = {
  rateUrl: string
  apiKey?: string
  timeoutMs: number
  minRate: number
  maxRate: number
  /** Injected for tests */
  fetchFn?: FetchLike
}

/**
 * Fetches NGN-per-USDC from a JSON HTTP endpoint (e.g. internal pricing service).
 * Response must include a rate field (see {@link parseFxRateFromJson}).
 */
export class HttpConversionProvider implements ConversionProvider {
  private readonly fetchImpl: FetchLike

  constructor(private readonly opts: HttpConversionProviderOptions) {
    this.fetchImpl = opts.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  private validateBoundedRate(rate: number): number {
    if (rate < this.opts.minRate || rate > this.opts.maxRate) {
      throw new ConversionProviderError(
        `FX rate ${rate} is outside allowed bounds [${this.opts.minRate}, ${this.opts.maxRate}]`,
        'INVALID_RESPONSE',
      )
    }
    return rate
  }

  async getRate(): Promise<ConversionRateQuote> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs)

    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (this.opts.apiKey) {
        headers.Authorization = `Bearer ${this.opts.apiKey}`
      }

      let res: Response
      try {
        res = await this.fetchImpl(this.opts.rateUrl, { method: 'GET', headers, signal: controller.signal })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new ConversionProviderError(`Conversion rate fetch failed: ${msg}`, 'NETWORK')
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ConversionProviderError(
          `Conversion rate HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
          res.status >= 500 ? 'NETWORK' : 'INVALID_RESPONSE',
        )
      }

      let json: unknown
      try {
        json = await res.json()
      } catch {
        throw new ConversionProviderError('Conversion rate response is not valid JSON', 'INVALID_RESPONSE')
      }

      const rate = this.validateBoundedRate(parseFxRateFromJson(json))
      const providerRef = parseOptionalProviderRef(json)
      return { rate, source: 'http', providerRef }
    } finally {
      clearTimeout(timer)
    }
  }

  async convertNgnToUsdc(input: ConvertNgnToUsdcInput): Promise<ConvertNgnToUsdcOutput> {
    if (input.amountNgn <= 0) {
      throw new ConversionProviderError('amountNgn must be positive', 'VALIDATION')
    }

    const quote = await this.getRate()
    const amountUsdc = input.amountNgn / quote.rate
    const providerRef = quote.providerRef ?? `http:${input.depositId}:${quote.rate}`

    return {
      amountUsdc: toUsdcDecimalString(amountUsdc),
      fxRateNgnPerUsdc: quote.rate,
      providerRef,
    }
  }
}

/**
 * Tries `primary`; on failure logs and delegates to `fallback` (typically {@link StubConversionProvider}).
 */
export class FallbackConversionProvider implements ConversionProvider {
  constructor(
    private readonly primary: ConversionProvider,
    private readonly fallback: ConversionProvider,
  ) {}

  async getRate(): Promise<ConversionRateQuote> {
    try {
      return await this.primary.getRate()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn('Conversion rate primary provider failed; using fallback', { error: msg })
      const quote = await this.fallback.getRate()
      return { ...quote, source: `fallback:${quote.source}` }
    }
  }

  async convertNgnToUsdc(input: ConvertNgnToUsdcInput): Promise<ConvertNgnToUsdcOutput> {
    try {
      return await this.primary.convertNgnToUsdc(input)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = e instanceof ConversionProviderError ? e.code : undefined
      logger.warn('Conversion primary provider failed; using deterministic stub fallback', {
        depositId: input.depositId,
        error: msg,
        code,
      })
      const out = await this.fallback.convertNgnToUsdc(input)
      return {
        ...out,
        providerRef: `fallback:${out.providerRef}`,
      }
    }
  }
}

/**
 * MVP stub conversion provider.
 * Deterministic and side-effect free.
 */
export class StubConversionProvider implements ConversionProvider {
  constructor(private fxRateNgnPerUsdc: number) {}

  async getRate(): Promise<ConversionRateQuote> {
    if (this.fxRateNgnPerUsdc <= 0) {
      throw new ConversionProviderError('fxRateNgnPerUsdc must be positive', 'VALIDATION')
    }
    return { rate: this.fxRateNgnPerUsdc, source: 'stub' }
  }

  async convertNgnToUsdc(input: ConvertNgnToUsdcInput): Promise<ConvertNgnToUsdcOutput> {
    if (input.amountNgn <= 0) {
      throw new ConversionProviderError('amountNgn must be positive', 'VALIDATION')
    }
    if (this.fxRateNgnPerUsdc <= 0) {
      throw new ConversionProviderError('fxRateNgnPerUsdc must be positive', 'VALIDATION')
    }

    const amountUsdc = input.amountNgn / this.fxRateNgnPerUsdc

    return {
      amountUsdc: toUsdcDecimalString(amountUsdc),
      fxRateNgnPerUsdc: this.fxRateNgnPerUsdc,
      providerRef: `stub:${input.depositId}`,
    }
  }
}
