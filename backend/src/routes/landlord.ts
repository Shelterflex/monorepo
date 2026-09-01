import { Router, Request, Response, NextFunction } from 'express'
import { getPool } from '../db.js'
import { userStore } from '../models/authStore.js'
import { AuthenticatedRequest } from '../middleware/auth.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { kycRepository, MAX_ATTEMPTS } from '../repositories/KycRepository.js'
import { getPaymentProvider } from '../payments/registry.js'

export function createLandlordRouter() {
  const router = Router()

  // GET /api/landlord/tenants
  router.get('/tenants', async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest
    try {
      const landlordId = authReq.user?.id
      if (!landlordId) throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized')

      const pool = await getPool()
      if (!pool) throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Database not available')

      const { rows } = await pool.query(
        `SELECT 
          d.deal_id as id,
          u.name,
          l.address as property,
          d.status,
          d.created_at as "leaseStart",
          (d.created_at + (d.term_months || ' month')::interval) as "leaseEnd",
          (d.annual_rent_ngn / 12) as "monthlyPayment",
          (SELECT COALESCE(SUM(amount_ngn), 0) FROM tenant_deal_schedules WHERE deal_id = d.deal_id AND status = 'paid') as "totalPaid"
        FROM tenant_deals d
        JOIN users u ON d.tenant_id = u.id::text AND u.deleted_at IS NULL
        JOIN whistleblower_listings l ON d.listing_id = l.listing_id AND l.deleted_at IS NULL
        WHERE d.landlord_id = $1 AND d.deleted_at IS NULL`,
        [landlordId]
      )

      res.json(rows.map(row => ({
        ...row,
        verified: true, // Standard verified status for now
        status: row.status === 'active' ? 'current' : row.status
      })))
    } catch (error) {
      next(error)
    }
  })

  // GET /api/landlord/settings
  router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest
    try {
      const userId = authReq.user?.id
      if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized')

      const user = await userStore.getByEmail(authReq.user!.email)
      const profile = await userStore.getLandlordProfile(userId)

      res.json({
        profile: {
          fullName: user?.name,
          email: user?.email,
          companyName: profile?.companyName || "",
          phone: profile?.phone || "",
          address: profile?.address || "",
        },
        notifications: profile?.notificationPreferences || {
          newInquiries: true,
          paymentUpdates: true,
          propertyViews: false,
          marketingTips: false
        },
        payout: {
          bankName: profile?.bankName || "",
          accountNumber: profile?.accountNumber || "",
          accountName: profile?.accountName || "",
        }
      })
    } catch (error) {
      next(error)
    }
  })

  // GET /api/landlord/kyc-status
  // Returns the landlord's current KYC status, rejection reasons, and attempts remaining.
  // Used by the frontend to gate listing creation.
  router.get('/kyc-status', async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest
    try {
      const userId = authReq.user?.id
      if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized')

      const record = await kycRepository.findByUserId(userId)

      if (!record) {
        return res.json({
          status: 'not_submitted',
          attemptsRemaining: MAX_ATTEMPTS,
          rejectionReason: null,
        })
      }

      res.json({
        status: record.status,
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - record.attemptCount),
        rejectionReason: record.rejectionReason,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
      })
    } catch (error) {
      next(error)
    }
  })

  // PATCH /api/landlord/settings
  router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest
    try {
      const userId = authReq.user?.id
      if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized')

      const { profile, notifications, payout } = authReq.body

      if (profile?.fullName) {
        await userStore.updateName(userId, profile.fullName)
      }

      await userStore.updateLandlordProfile(userId, {
        phone: profile?.phone,
        address: profile?.address,
        companyName: profile?.companyName,
        bankName: payout?.bankName,
        accountNumber: payout?.accountNumber,
        accountName: payout?.accountName,
        notificationPreferences: notifications
      })

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // POST /api/landlord/payout/verify-account
  router.post('/payout/verify-account', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bankName, bankCode, accountNumber } = req.body ?? {}

      if (!bankName && !bankCode) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Bank name and account number are required')
      }
      if (!accountNumber || String(accountNumber).trim().length < 10) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid account number length')
      }

      const provider = getPaymentProvider('paystack')
      if (!provider.resolveBankAccount) {
        throw new AppError(ErrorCode.PAYMENT_PROVIDER_ERROR, 502, 'Bank account resolution is not supported')
      }

      const result = await provider.resolveBankAccount(
        String(accountNumber).trim(),
        String(bankCode || bankName).trim(),
      )

      res.json({
        success: true,
        accountName: result.accountName,
        accountNumber: result.accountNumber,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
