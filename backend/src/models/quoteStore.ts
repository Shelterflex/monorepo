import { randomUUID } from 'node:crypto'
import { type QuoteRecord, type PaymentRail } from './quote.js'

class QuoteStore {
  private byId = new Map<string, QuoteRecord>()

  async getById(quoteId: string): Promise<QuoteRecord | null> {
    return this.byId.get(quoteId) ?? null
  }

  async create(input: {
    userId: string
    amountNgn: number
    paymentRail: PaymentRail
    fxRateNgnPerUsdc: number
    feePercent: number
    slippagePercent: number
    expiryMs: number
  }): Promise<QuoteRecord> {
    const now = new Date()
    const feesNgn = Math.round(input.amountNgn * input.feePercent)
    const netNgn = input.amountNgn - feesNgn
    const effectiveRate = input.fxRateNgnPerUsdc * (1 + input.slippagePercent)
    const estimatedAmountUsdc = (netNgn / effectiveRate).toFixed(6)
    const record: QuoteRecord = {
      quoteId: randomUUID(),
      userId: input.userId,
      amountNgn: input.amountNgn,
      paymentRail: input.paymentRail,
      estimatedAmountUsdc,
      fxRateNgnPerUsdc: input.fxRateNgnPerUsdc,
      feesNgn,
      expiresAt: new Date(now.getTime() + input.expiryMs),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    this.byId.set(record.quoteId, record)
    return record
  }

  async markUsed(quoteId: string): Promise<QuoteRecord | null> {
    const existing = this.byId.get(quoteId)
    if (!existing) return null
    if (existing.status === 'used') return existing
    const now = new Date()
    const updated: QuoteRecord = { ...existing, status: 'used', updatedAt: now }
    this.byId.set(quoteId, updated)
    return updated
  }

  async markExpired(quoteId: string): Promise<QuoteRecord | null> {
    const existing = this.byId.get(quoteId)
    if (!existing) return null
    if (existing.status === 'expired') return existing
    // 'used' status takes precedence over 'expired'
    if (existing.status === 'used') return existing
    const now = new Date()
    const updated: QuoteRecord = { ...existing, status: 'expired', updatedAt: now }
    this.byId.set(quoteId, updated)
    return updated
  }

  async clear(): Promise<void> {
    this.byId.clear()
  }
}

export const quoteStore = new QuoteStore()
