/**
 * Gathers the data for landlord analytics (issue #2054). It reads the landlord's
 * properties, their current deals and repayment schedules, and passes normalised
 * inputs to the pure maths in landlordAnalytics.ts.
 *
 * Only the caller's properties are read. A propertyId that is not one of them gets
 * the same 404 as a property that does not exist.
 */

import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { landlordPropertyStore } from '../models/landlordPropertyStore.js'
import type { LandlordProperty } from '../models/landlordProperty.js'
import { listingStore } from '../models/listingStore.js'
import { dealStore } from '../models/dealStore.js'
import { DealStatus, ScheduleItemStatus, type DealWithSchedule } from '../models/deal.js'
import { getSchedule } from './repaymentScheduleService.js'
import {
  computeOccupancyTrend,
  computePaymentTrends,
  computeRevenueBreakdown,
  computeVacancyMetrics,
  type AnalyticsWindow,
  type LandlordAnalytics,
  type OccupancyInput,
  type PaymentRecord,
  type VacancyFill,
} from './landlordAnalytics.js'

/** A deal in one of these statuses has the property occupied. */
const OCCUPIED_STATUSES = new Set<DealStatus>([
  DealStatus.ACTIVE,
  DealStatus.AT_RISK,
  DealStatus.COMPLETED,
  DealStatus.DEFAULTED,
])

const PROPERTY_PAGE_SIZE = 100

/** Every property the landlord owns, across all pages. */
async function allPropertiesOf(landlordId: string): Promise<LandlordProperty[]> {
  const all: LandlordProperty[] = []
  for (let page = 1; ; page += 1) {
    const result = await landlordPropertyStore.list({ landlordId, page, pageSize: PROPERTY_PAGE_SIZE })
    all.push(...result.properties)
    if (page >= result.totalPages || result.properties.length === 0) break
  }
  return all
}

/** The deal currently linked to a property through its listing, if there is one. */
async function currentDealOf(property: LandlordProperty): Promise<DealWithSchedule | null> {
  if (!property.listingId) return null
  const listing = await listingStore.getById(property.listingId)
  if (!listing?.dealId) return null
  return dealStore.findById(listing.dealId)
}

/**
 * Instalments for a deal. The stored repayment schedule is used when the database
 * is configured. Otherwise the schedule on the deal is used. Waived instalments are
 * not expected revenue, so they are left out.
 */
async function paymentsOf(deal: DealWithSchedule): Promise<PaymentRecord[]> {
  if (await getPool()) {
    const stored = await getSchedule(deal.dealId)
    if (stored && stored.schedule.length > 0) {
      return stored.schedule
        .filter((item) => item.status !== 'waived')
        .map((item) => ({
          amountNgn: item.totalAmountNgn,
          dueDate: item.dueDate,
          paid: item.status === 'paid',
          paidAt: item.paidAt,
        }))
    }
  }

  return deal.schedule.map((item) => ({
    amountNgn: item.amountNgn,
    dueDate: new Date(item.dueDate),
    paid: item.status === ScheduleItemStatus.PAID,
  }))
}

/**
 * Analytics for one landlord over a window. When `propertyId` is given, the result
 * covers that one property. Otherwise it covers every property the landlord owns.
 */
export async function computeLandlordAnalytics(params: {
  landlordId: string
  window: AnalyticsWindow
  propertyId?: string
  now: Date
}): Promise<LandlordAnalytics> {
  const { landlordId, window, propertyId, now } = params

  const owned = await allPropertiesOf(landlordId)
  const scoped = propertyId ? owned.filter((p) => p.id === propertyId) : owned
  if (propertyId && scoped.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
  }

  const occupancy: OccupancyInput[] = []
  const fills: VacancyFill[] = []
  const payments: PaymentRecord[] = []

  for (const property of scoped) {
    const deal = await currentDealOf(property)
    const occupied = deal !== null && OCCUPIED_STATUSES.has(deal.status)

    occupancy.push({
      propertyId: property.id,
      occupiedFrom: deal && occupied ? deal.createdAt : undefined,
    })

    if (deal && occupied) {
      // The property was available from when it was created, and let when the deal started.
      fills.push({ availableFrom: property.createdAt, filledAt: deal.createdAt })
      payments.push(...(await paymentsOf(deal)))
    }
  }

  return {
    occupancyTrend: computeOccupancyTrend(occupancy, window.start, window.end),
    revenueBreakdown: computeRevenueBreakdown(payments, window.start, window.end),
    paymentTrends: computePaymentTrends(payments, window.start, window.end, now),
    vacancyMetrics: computeVacancyMetrics(occupancy, fills),
  }
}
