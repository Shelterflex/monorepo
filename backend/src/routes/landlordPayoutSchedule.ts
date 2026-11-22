/**
 * Landlord payout schedule routes (issue #2055). Landlord only, and every query
 * is scoped to the authenticated landlord.
 *
 *   GET /api/v1/landlord/payout-schedule                 upcoming payouts, grouped by property and period
 *   GET /api/v1/landlord/payout-schedule/payouts         payout history, paginated
 *   GET /api/v1/landlord/payout-schedule/preference      frequency and payout destination
 *   PUT /api/v1/landlord/payout-schedule/preference      update frequency, destination, or both
 *   GET /api/v1/landlord/payout-schedule/:payoutId       one payout (404 if it is not theirs)
 *
 * Net is always gross minus fees. The destination bank account is kept on the
 * landlord profile, and responses show only its last four digits.
 */

import { Router, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { landlordPayoutScheduleStore } from '../models/landlordPayoutScheduleStore.js'
import { userStore, type LandlordProfile } from '../models/authStore.js'
import {
  listPayoutScheduleSchema,
  payoutScheduleIdParamsSchema,
  payoutScheduleQuerySchema,
  updatePayoutPreferenceBodySchema,
  type ListPayoutScheduleRequest,
  type PayoutScheduleQuery,
  type UpdatePayoutPreferenceBody,
} from '../schemas/landlordPayoutSchedule.js'
import {
  groupPayoutsByProperty,
  isUpcoming,
  summarizePayouts,
  withNetAmount,
} from '../services/landlordPayoutScheduleGrouping.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'

function requireLandlord(req: AuthenticatedRequest) {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  if (req.user.role !== 'landlord') {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can view payout schedules')
  }
  return req.user
}

/** The destination account as the API returns it: the last four digits only. */
function destinationFrom(profile: LandlordProfile | null) {
  if (!profile?.bankName || !profile.accountNumber || !profile.accountName) return null
  return {
    bankName: profile.bankName,
    accountName: profile.accountName,
    accountNumberLast4: profile.accountNumber.slice(-4),
  }
}

export function createLandlordPayoutScheduleRouter(): Router {
  const router = Router()

  router.get(
    '/',
    authenticateToken,
    validate(payoutScheduleQuerySchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireLandlord(req)
        const query = req.query as unknown as PayoutScheduleQuery

        const payouts = await landlordPayoutScheduleStore.listForLandlord(user.id, {
          propertyId: query.propertyId,
          from: query.from,
          to: query.to,
        })
        const upcoming = payouts.filter(isUpcoming)

        res.json({
          success: true,
          data: {
            grouping: query.grouping,
            properties: groupPayoutsByProperty(upcoming, query.grouping),
            summary: summarizePayouts(upcoming),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/payouts',
    authenticateToken,
    validate(listPayoutScheduleSchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireLandlord(req)
        const query = req.query as unknown as ListPayoutScheduleRequest

        const { items, total } = await landlordPayoutScheduleStore.listPageForLandlord(
          user.id,
          {
            propertyId: query.propertyId,
            status: query.status,
            channel: query.channel,
            from: query.from,
            to: query.to,
          },
          query.page,
          query.pageSize,
        )

        res.json({
          success: true,
          data: items.map(withNetAmount),
          pagination: {
            total,
            page: query.page,
            pageSize: query.pageSize,
            totalPages: Math.ceil(total / query.pageSize),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/preference',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireLandlord(req)
        const [schedulePreference, profile] = await Promise.all([
          landlordPayoutScheduleStore.getPreference(user.id),
          userStore.getLandlordProfile(user.id),
        ])

        res.json({
          success: true,
          data: { schedulePreference, destination: destinationFrom(profile) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.put(
    '/preference',
    authenticateToken,
    validate(updatePayoutPreferenceBodySchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireLandlord(req)
        const body = req.body as UpdatePayoutPreferenceBody
        const changed: string[] = []

        if (body.destination) {
          await userStore.updateLandlordProfile(user.id, {
            bankName: body.destination.bankName,
            accountNumber: body.destination.accountNumber,
            accountName: body.destination.accountName,
          })
          changed.push('destination')
        }

        let schedulePreference = await landlordPayoutScheduleStore.getPreference(user.id)
        if (body.schedulePreference) {
          schedulePreference = await landlordPayoutScheduleStore.setPreference(
            user.id,
            body.schedulePreference,
          )
          changed.push('schedulePreference')
        }

        // Log what changed, never the full account number.
        auditLog('LANDLORD_PAYOUT_PREFERENCE_UPDATED', extractAuditContext(req, 'user'), {
          changed,
          schedulePreference: body.schedulePreference,
          accountNumberLast4: body.destination?.accountNumber.slice(-4),
        })

        const profile = await userStore.getLandlordProfile(user.id)
        res.json({
          success: true,
          data: { schedulePreference, destination: destinationFrom(profile) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:payoutId',
    authenticateToken,
    validate(payoutScheduleIdParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireLandlord(req)
        const payout = await landlordPayoutScheduleStore.findForLandlord(user.id, req.params.payoutId)

        // A payout that belongs to someone else gets the same 404 as one that does not exist.
        if (!payout) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Payout not found')
        }
        res.json({ success: true, data: withNetAmount(payout) })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
