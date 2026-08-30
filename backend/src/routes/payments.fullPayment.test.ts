import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'

describe('POST /api/payments/confirm includes full-payment payout breakdown', () => {
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.FULL_PAYMENT_SPLIT_VERSION = 'test-v1'
    process.env.FULL_PAYMENT_PLATFORM_SHARE = '0.1'
    process.env.FULL_PAYMENT_REPORTER_SHARE = '0.05'
    vi.resetModules()

    const { settlementLedgerStore } = await import('../models/settlementLedgerStore.js')
    await settlementLedgerStore.clear()
  })

  it('returns payout breakdown and persists settlement ledger entries', async () => {
    const { createApp } = await import('../app.js')
    const { settlementLedgerStore } = await import('../models/settlementLedgerStore.js')
    const app = createApp()

    // Create a deal (no listing linkage required for this test)
    const createDealRes = await request(app)
      .post('/api/deals')
      .send({
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        annualRentNgn: 1200000,
        depositNgn: 240000,
        termMonths: 12,
      })

    expect(createDealRes.status).toBe(201)
    const dealId = createDealRes.body.data.dealId

    const res = await request(app)
      .post('/api/payments/confirm')
      .send({
        dealId,
        txType: 'tenant_repayment',
        amountUsdc: '100.00',
        tokenAddress: 'USDC_TOKEN_ADDRESS_TESTNET',
        externalRefSource: 'manual',
        externalRef: 'fullpay-1',
        amountNgn: 960000,
        fxRateNgnPerUsdc: 1000,
        fxProvider: 'stub',
      })

    expect([200, 202]).toContain(res.status)
    expect(res.body.payoutBreakdown).toBeDefined()
    expect(res.body.payoutBreakdown.platformAmountNgn).toBeDefined()
    expect(res.body.payoutBreakdown.landlordNetAmountNgn).toBeDefined()
    expect(res.body.payoutBreakdown.reporterAmountNgn).toBe(0)

    const entries = await settlementLedgerStore.listByDealId(dealId, 'full_payment_incentive')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.beneficiaryType === 'platform')).toBe(true)
  }, 60000)
})
