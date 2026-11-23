/**
 * Tenant lease endpoints
 *
 * - GET /tenant/lease/current          → summary of the tenant's active lease
 * - GET /tenant/deals/:dealId/lease    → full lease details for one deal
 *
 * All reads are tenant-scoped: a deal that belongs to another user (or does not
 * exist) yields 404 so tenants cannot probe for other people's leases.
 */

import { Router, Response } from 'express'
import { z } from 'zod'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { dealStore } from '../models/dealStore.js'
import { listingStore } from '../models/listingStore.js'
import { userStore } from '../models/authStore.js'
import { DealStatus } from '../models/deal.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { getSchedule } from '../services/repaymentScheduleService.js'

interface DealLike {
  dealId: string
  tenantId: string
  landlordId: string
  listingId?: string
  annualRentNgn: number
  depositNgn: number
  financedAmountNgn: number
  termMonths: number
  createdAt: Date
  status: DealStatus
  schedule: Array<{ period: number; dueDate: string; amountNgn: number; status: string }>
}

const dealIdParamSchema = z.object({
  dealId: z.string().uuid(),
})

/**
 * Tenant-scoped lookup. Returns the deal with its schedule, or throws 404 when
 * the deal is missing or belongs to another tenant.
 */
async function requireOwnedDeal(dealId: string, tenantId: string): Promise<DealLike> {
  const deal = await dealStore.findById(dealId)
  if (!deal || deal.tenantId !== tenantId) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Deal not found')
  }
  return deal
}

/**
 * Human-readable lease duration, e.g. "12 months".
 */
function formatDuration(termMonths: number): string {
  return `${termMonths} month${termMonths === 1 ? '' : 's'}`
}

function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  )
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

/**
 * Summarize a deal's schedule to compute payment progress.
 * Uses the stored schedule from the deal if available, otherwise falls back
 * to the repayment_schedule table.
 */
async function summariseSchedule(
  deal: DealLike,
  dealId: string
): Promise<{ totalPaid: number; totalOwed: number; paymentsCompleted: number; next?: { dueDate: string } }> {
  // Try to get the repayment schedule from the database first
  const repaymentSchedule = await getSchedule(dealId)
  
  if (repaymentSchedule) {
    const paid = repaymentSchedule.schedule.filter((item) => item.status === 'paid')
    const totalPaid = paid.reduce((sum, item) => sum + item.totalAmountNgn, 0)
    const totalOwed = repaymentSchedule.schedule.reduce((sum, item) => sum + item.totalAmountNgn, 0)
    const next = repaymentSchedule.schedule.find((item) => item.status !== 'paid')
    return { 
      totalPaid, 
      totalOwed, 
      paymentsCompleted: paid.length,
      next: next ? { dueDate: next.dueDate.toISOString() } : undefined
    }
  }

  // Fallback to the deal's embedded schedule
  const paid = deal.schedule.filter((item) => item.status === 'paid')
  const totalPaid = paid.reduce((sum, item) => sum + item.amountNgn, 0)
  const totalOwed = deal.schedule.reduce((sum, item) => sum + item.amountNgn, 0)
  const next = deal.schedule.find((item) => item.status !== 'paid')
  return { totalPaid, totalOwed, paymentsCompleted: paid.length, next: next ? { dueDate: next.dueDate } : undefined }
}

/**
 * Choose the "current" lease when a tenant has several deals.
 * Rule: prefer an active deal; if multiple active deals exist, choose the most recently created.
 * If no active deal, return null (handled by the caller).
 */
async function getCurrentDeal(tenantId: string): Promise<DealLike | null> {
  const { deals } = await dealStore.findMany({ tenantId, pageSize: 100 })
  const activeDeals = deals.filter((deal) => deal.status === DealStatus.ACTIVE)
  
  if (activeDeals.length === 0) {
    return null
  }

  // Sort by creation date descending to get the most recent active deal
  activeDeals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  
  // Load the full deal with schedule
  return await dealStore.findById(activeDeals[0].dealId)
}

/**
 * Check if the authenticated user is a tenant. Returns false for admin/super_admin.
 */
function isTenant(req: AuthenticatedRequest): boolean {
  const role = req.user?.role
  return role === 'tenant'
}

const router = Router()

/**
 * GET /tenant/lease/current
 * Returns the tenant's current active lease summary.
 * If no active lease exists, returns a response with data: null that the dashboard
 * renders as "no active lease".
 */
router.get(
  '/tenant/lease/current',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const tenantId = req.user?.id
      if (!tenantId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized')
      }

      // Only tenants can access their lease data
      if (!isTenant(req)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only tenants can access lease data')
      }

      const deal = await getCurrentDeal(tenantId)
      if (!deal) {
        // Return null data to indicate no active lease (dashboard handles this gracefully)
        return res.json({
          success: true,
          data: null,
        })
      }

      const listing = deal.listingId ? await listingStore.getById(deal.listingId) : null
      const landlord = await userStore.getById(deal.landlordId)

      const { totalPaid, totalOwed, next } = await summariseSchedule(deal, deal.dealId)
      const leaseEnd = addMonths(deal.createdAt, deal.termMonths)
      
      // Clamp progress to 0-100
      const progress = totalOwed === 0 ? 0 : Math.min(100, Math.max(0, Math.round((totalPaid / totalOwed) * 100)))

      res.json({
        success: true,
        data: {
          dealId: deal.dealId,
          property: listing?.address ?? 'Rental property',
          location: [listing?.area, listing?.city].filter(Boolean).join(', '),
          monthlyPayment: Math.round(deal.financedAmountNgn / deal.termMonths),
          nextPaymentDate: next?.dueDate ?? '',
          leaseEnd: leaseEnd.toISOString(),
          totalPaid,
          totalOwed,
          progress,
          landlord: { name: landlord?.name ?? 'Landlord' },
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /tenant/deals/:dealId/lease
 * Returns full lease details for a specific deal.
 * Tenant-scoped: returns 404 if the deal doesn't belong to the tenant.
 */
router.get(
  '/tenant/deals/:dealId/lease',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const tenantId = req.user?.id
      if (!tenantId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized')
      }

      // Only tenants can access their lease data
      if (!isTenant(req)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only tenants can access lease data')
      }

      const { dealId } = dealIdParamSchema.parse(req.params)
      const deal = await requireOwnedDeal(dealId, tenantId)
      
      const listing = deal.listingId ? await listingStore.getById(deal.listingId) : null
      const landlord = await userStore.getById(deal.landlordId)
      const landlordProfile = await userStore.getLandlordProfile(deal.landlordId)

      const { totalPaid, totalOwed, paymentsCompleted } = await summariseSchedule(deal, deal.dealId)
      const duration = monthsBetween(deal.createdAt, addMonths(deal.createdAt, deal.termMonths))

      res.json({
        success: true,
        data: {
          dealId: deal.dealId,
          property: {
            title: listing?.address ?? 'Rental property',
            address: [listing?.address, listing?.area, listing?.city]
              .filter(Boolean)
              .join(', '),
            beds: listing?.bedrooms ?? 0,
            baths: listing?.bathrooms ?? 0,
            // Listing has no square-metre field yet; kept at 0 until the
            // property schema grows one.
            sqm: 0,
          },
          lease: {
            startDate: deal.createdAt.toISOString(),
            endDate: addMonths(deal.createdAt, deal.termMonths).toISOString(),
            duration: formatDuration(duration),
            monthlyPayment: Math.round(deal.financedAmountNgn / deal.termMonths),
            status: deal.status,
          },
          landlord: {
            name: landlord?.name ?? 'Landlord',
            ...(landlordProfile?.companyName ? { company: landlordProfile.companyName } : {}),
            phone: landlordProfile?.phone ?? '',
            email: landlord?.email ?? '',
          },
          paymentProgress: {
            totalPaid,
            totalOwed,
            paymentsCompleted,
            totalPayments: deal.schedule.length,
          },
        },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

export function createTenantLeaseRouter(): Router {
  return router
}
