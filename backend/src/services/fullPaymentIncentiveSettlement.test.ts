import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The split config is read from env when the schema module loads, so set it before any import runs.
vi.hoisted(() => {
  process.env.FULL_PAYMENT_SPLIT_VERSION = 'test-v1'
  process.env.FULL_PAYMENT_PLATFORM_SHARE = '0.1'
  process.env.FULL_PAYMENT_REPORTER_SHARE = '0.05'
})

vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  // Force the in-memory stores so the test never touches Postgres.
  // A plain function, not vi.fn: vi.restoreAllMocks() would reset a vi.fn to return undefined.
  getPool: async () => null,
}))

import { dealStore } from '../models/dealStore.js'
import { listingStore } from '../models/listingStore.js'
import { settlementLedgerStore } from '../models/settlementLedgerStore.js'
import { settleFullPaymentIncentive } from './fullPaymentIncentiveSettlement.js'

const DEAL_ID = 'deal-1'
const LANDLORD_ID = 'landlord-1'
const LISTING_ID = 'listing-1'
const REPORTER_ID = 'wb-1'

type Fixture = Record<string, unknown>

function deal(overrides: Fixture = {}): Fixture {
  return {
    dealId: DEAL_ID,
    tenantId: 'tenant-1',
    landlordId: LANDLORD_ID,
    listingId: LISTING_ID,
    financedAmountNgn: 1000,
    ...overrides,
  }
}

function listing(whistleblowerId: string): Fixture {
  return { listingId: LISTING_ID, whistleblowerId }
}

// The stores' full types carry many fields the settlement never reads, so fixtures are cast at the spy.
function givenDeal(value: Fixture | null) {
  vi.spyOn(dealStore, 'findById').mockResolvedValue(value as never)
}

function givenListing(value: Fixture | null) {
  vi.spyOn(listingStore, 'getById').mockResolvedValue(value as never)
}

async function ledgerFor(dealId = DEAL_ID) {
  return settlementLedgerStore.listByDealId(dealId)
}

describe('settleFullPaymentIncentive (#2120)', () => {
  beforeEach(async () => {
    await settlementLedgerStore.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('guards', () => {
    it('returns null and writes nothing when the deal does not exist', async () => {
      givenDeal(null)

      const result = await settleFullPaymentIncentive({ dealId: 'missing', grossAmountNgn: 1000 })

      expect(result).toBeNull()
      expect(await ledgerFor('missing')).toEqual([])
    })

    it('returns null and writes nothing when the payment is below the financed amount', async () => {
      givenDeal(deal({ financedAmountNgn: 1000 }))
      givenListing(listing(REPORTER_ID))

      const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 999 })

      expect(result).toBeNull()
      expect(await ledgerFor()).toEqual([])
    })

    it('applies when the payment equals the financed amount exactly', async () => {
      givenDeal(deal({ financedAmountNgn: 1000 }))
      givenListing(listing(REPORTER_ID))

      const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(result).not.toBeNull()
      expect(await ledgerFor()).toHaveLength(3)
    })

    it('throws on a zero payment when the deal has no financed amount, and writes nothing', async () => {
      givenDeal(deal({ financedAmountNgn: 0 }))
      givenListing(null)

      await expect(
        settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 0 }),
      ).rejects.toThrow('grossAmountNgn must be a positive number')
      expect(await ledgerFor()).toEqual([])
    })
  })

  describe('split and ledger rows', () => {
    it('splits a full payment into platform, reporter and landlord shares when a reporter is applied', async () => {
      givenDeal(deal())
      givenListing(listing(REPORTER_ID))

      const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(result).toEqual({
        dealId: DEAL_ID,
        platformAmountNgn: 100,
        reporterAmountNgn: 50,
        landlordNetAmountNgn: 850,
        splitConfigVersion: 'test-v1',
        reporterApplied: true,
        reporterId: REPORTER_ID,
      })

      const rows = await ledgerFor()
      const byType = Object.fromEntries(rows.map((r) => [r.beneficiaryType, r]))
      expect(byType.platform.amountNgn).toBe(100)
      expect(byType.reporter.amountNgn).toBe(50)
      expect(byType.reporter.beneficiaryId).toBe(REPORTER_ID)
      expect(byType.landlord.amountNgn).toBe(850)
      expect(byType.landlord.beneficiaryId).toBe(LANDLORD_ID)
      for (const row of rows) {
        expect(row.splitConfigVersion).toBe('test-v1')
        expect(row.splitConfigSnapshot).toEqual({ platformShare: 0.1, reporterShare: 0.05, reporterApplied: true })
      }
    })

    it('gives the reporter nothing and no reporter row when the reporter is not applied', async () => {
      // A whitespace-only whistleblower id counts as "not applied".
      givenDeal(deal())
      givenListing(listing('   '))

      const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(result?.reporterApplied).toBe(false)
      expect(result?.reporterAmountNgn).toBe(0)
      expect(result?.reporterId).toBeUndefined()
      expect(result?.landlordNetAmountNgn).toBe(900)

      const rows = await ledgerFor()
      expect(rows.map((r) => r.beneficiaryType).sort()).toEqual(['landlord', 'platform'])
    })

    it('does not look up a listing when the deal has none, and treats the reporter as not applied', async () => {
      givenDeal(deal({ listingId: undefined }))
      const getById = vi.spyOn(listingStore, 'getById')

      const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(getById).not.toHaveBeenCalled()
      expect(result?.reporterApplied).toBe(false)
    })

    it('uses the same split and no reporter when the listing does not exist', async () => {
      givenDeal(deal())
      givenListing(null)

      const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(result?.reporterApplied).toBe(false)
      expect(result?.landlordNetAmountNgn).toBe(900)
    })

    it.each([
      [1, 0, 0, 1],
      [3, 0, 0, 3],
      [1001, 100, 50, 851],
      [1005, 101, 50, 854],
      [99999, 10000, 5000, 84999],
    ])(
      'splits gross %i into platform %i, reporter %i, landlord %i and the three rows sum to gross',
      async (gross, platform, reporter, landlord) => {
        givenDeal(deal({ financedAmountNgn: gross }))
        givenListing(listing(REPORTER_ID))

        const result = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: gross })

        expect(result).toMatchObject({
          platformAmountNgn: platform,
          reporterAmountNgn: reporter,
          landlordNetAmountNgn: landlord,
        })
        const rows = await ledgerFor()
        const total = rows.reduce((sum, r) => sum + r.amountNgn, 0)
        expect(total).toBe(gross)
      },
    )

    it('still writes a zero-amount reporter row for a tiny payment when a reporter is applied', async () => {
      // Current behaviour, noted for review: amounts that round to zero still create ledger rows.
      givenDeal(deal({ financedAmountNgn: 1 }))
      givenListing(listing(REPORTER_ID))

      await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1 })

      const reporterRow = (await ledgerFor()).find((r) => r.beneficiaryType === 'reporter')
      expect(reporterRow?.amountNgn).toBe(0)
    })
  })

  describe('repeated settlement', () => {
    it('returns the same result when the same deal is settled twice', async () => {
      givenDeal(deal())
      givenListing(listing(REPORTER_ID))

      const first = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })
      const second = await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(second).toEqual(first)
    })

    it.fails('does not write a second set of ledger rows for the same deal', async () => {
      // Known gap for #2120: Postgres enforces one row per (deal, event, beneficiary) via
      // ON CONFLICT DO NOTHING, but the in-memory store used here does not, so a second
      // settlement doubles the ledger. it.fails until the in-memory store enforces the same key.
      givenDeal(deal())
      givenListing(listing(REPORTER_ID))

      await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })
      await settleFullPaymentIncentive({ dealId: DEAL_ID, grossAmountNgn: 1000 })

      expect(await ledgerFor()).toHaveLength(3)
    })
  })
})
