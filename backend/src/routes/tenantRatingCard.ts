import { Router } from 'express'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { tenantRatingService } from '../services/tenantRatingService.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'
import { publicTenantRatingRateLimit } from '../middleware/publicRatingRateLimit.js'

const router = Router()

function assertLandlordOrAdmin(req: AuthenticatedRequest) {
  if (req.user?.role !== 'landlord' && req.user?.role !== 'admin') {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can submit ratings')
  }
}

router.post('/ratings/tenant', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    assertLandlordOrAdmin(req)

    const { tenantId, dealId, paymentTimeliness, propertyCare, communication, overall, comment } = req.body

    if (!tenantId || !dealId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'tenantId and dealId are required')
    }

    const rating = await tenantRatingService.submitRating(req.user!.id, tenantId, dealId, {
      paymentTimeliness,
      propertyCare,
      communication,
      overall,
      comment,
    })

    auditLog('TENANT_RATING_SUBMITTED' as any, extractAuditContext(req, 'user'), {
      tenantId,
      dealId,
      ratingId: rating.id,
      overall,
    })

    res.status(201).json({ success: true, data: rating })
  } catch (error) {
    next(error)
  }
})

router.get('/ratings/tenant/my-card', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = req.user?.id
    if (!tenantId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
    }

    const card = await tenantRatingService.getCard(tenantId)
    res.json({ success: true, data: card })
  } catch (error) {
    next(error)
  }
})

router.post('/ratings/tenant/share-token', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = req.user?.id
    if (!tenantId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
    }

    const token = await tenantRatingService.generateShareToken(tenantId)

    auditLog('TENANT_RATING_SHARE_TOKEN_GENERATED' as any, extractAuditContext(req, 'user'), {
      tenantId,
      tokenId: token.id,
      expiresAt: token.expiresAt.toISOString(),
    })

    res.status(201).json({
      success: true,
      data: {
        token: token.token,
        expiresAt: token.expiresAt.toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/public/tenant-rating/:token', publicTenantRatingRateLimit(), async (req, res, next) => {
  try {
    const { token } = req.params
    const card = await tenantRatingService.getCardByToken(token)

    if (!card) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Rating card not found or token has expired')
    }

    res.json({ success: true, data: card })
  } catch (error) {
    next(error)
  }
})

export function createTenantRatingCardRouter() {
  return router
}
