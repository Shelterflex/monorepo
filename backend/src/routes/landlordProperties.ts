import { Router, Response } from 'express'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { landlordPropertyStore } from '../models/landlordPropertyStore.js'
import {
  createPropertySchema,
  updatePropertySchema,
  propertyFiltersSchema,
} from '../schemas/landlordProperty.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { PropertyStatus } from '../models/landlordProperty.js'
import { PricingValidationError } from '../services/pricingService.js'
import { syncLandlordPropertyListing } from '../services/landlordPropertyListingSync.js'
import { PostgresUserRepository } from '../repositories/AuthRepository.js'
import { createSorobanAdapter, getSorobanConfigFromEnv } from '../soroban/index.js'
import { getPool } from '../db.js'

const router = Router()

function assertLandlord(req: AuthenticatedRequest) {
  if (req.user?.role !== 'landlord' && req.user?.role !== 'admin') {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can access this resource')
  }
}

function assertOwner(propertyLandlordId: string, req: AuthenticatedRequest) {
  if (req.user?.role === 'admin') return
  if (propertyLandlordId !== req.user?.id) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to modify this property')
  }
}

async function assertVerificationLevel(userId: string) {
  const pool = await getPool()
  if (!pool) return

  try {
    const { rows } = await pool.query(
      `SELECT verification_level FROM landlord_profiles WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    )

    const level = rows[0]?.verification_level ?? 'unverified'
    if (level === 'unverified') {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        403,
        'You must complete landlord verification before creating properties',
      )
    }
  } catch (err) {
    if (err instanceof AppError) throw err
  }
}

router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      assertLandlord(req)
      const filters = propertyFiltersSchema.parse(req.query)
      const result = await landlordPropertyStore.list({
        ...filters,
        landlordId: req.user!.id,
      })
      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      assertLandlord(req)
      const property = await landlordPropertyStore.getById(req.params.id)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }
      assertOwner(property.landlordId, req)
      res.json(property)
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (req.user?.role !== 'landlord') {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can create properties')
      }

      await assertVerificationLevel(req.user.id)

      // Verify on-chain allowlist status for KYC-approved landlords (non-blocking)
      try {
        const authRepository = new PostgresUserRepository()
        const user = await authRepository.getById(req.user.id)
        if (user?.walletAddress) {
          const sorobanConfig = getSorobanConfigFromEnv(process.env)
          const sorobanAdapter = createSorobanAdapter(sorobanConfig)
          const isAllowlisted = sorobanAdapter.isAllowlisted ? await sorobanAdapter.isAllowlisted(user.walletAddress) : false
          
          logger.info('On-chain allowlist check for property creation', {
            userId: req.user.id,
            walletAddress: user.walletAddress,
            isAllowlisted: isAllowlisted || false,
          })

          // Log mismatch but don't block - DB KYC is primary gate
          if (!isAllowlisted) {
            logger.warn('DB/chain mismatch: user KYC-approved but not on-chain allowlisted', {
              userId: req.user.id,
              walletAddress: user.walletAddress,
            })
          }
        }
      } catch (error) {
        // Allowlist check is informational only; don't block property creation on errors
        logger.warn('Failed to check on-chain allowlist status (non-blocking)', {
          userId: req.user.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      const input = createPropertySchema.parse(req.body)
      let property = await landlordPropertyStore.create({
        ...input,
        landlordId: req.user.id,
      })

      property = await syncLandlordPropertyListing(property)

      logger.info('Property created', { propertyId: property.id, landlordId: req.user.id })
      res.status(201).json(property)
    } catch (error) {
      if (error instanceof PricingValidationError) {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

router.patch(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (req.user?.role !== 'landlord') {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can update properties')
      }

      const existing = await landlordPropertyStore.getById(req.params.id)
      if (!existing) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }
      assertOwner(existing.landlordId, req)

      const input = updatePropertySchema.parse(req.body)
      let updated = await landlordPropertyStore.update(req.params.id, input)
      if (!updated) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      updated = await syncLandlordPropertyListing(updated)

      logger.info('Property updated', { propertyId: req.params.id, landlordId: req.user.id })
      res.json(updated)
    } catch (error) {
      if (error instanceof PricingValidationError) {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

router.patch(
  '/:id/deactivate',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const existing = await landlordPropertyStore.getById(req.params.id)
      if (!existing) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }
      assertOwner(existing.landlordId, req)

      let updated = await landlordPropertyStore.update(req.params.id, {
        status: PropertyStatus.DEACTIVATED,
      })
      if (!updated) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      updated = await syncLandlordPropertyListing(updated)

      logger.info('Property deactivated', { propertyId: req.params.id })
      res.json(updated)
    } catch (error) {
      next(error)
    }
  },
)

router.patch(
  '/:id/relist',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const existing = await landlordPropertyStore.getById(req.params.id)
      if (!existing) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }
      assertOwner(existing.landlordId, req)

      if (existing.status !== PropertyStatus.DEACTIVATED) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Only deactivated listings can be relisted',
        )
      }

      let updated = await landlordPropertyStore.update(req.params.id, {
        status: PropertyStatus.PENDING_REVIEW,
      })
      if (!updated) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      updated = await syncLandlordPropertyListing(updated)

      logger.info('Property relisted', { propertyId: req.params.id })
      res.json(updated)
    } catch (error) {
      next(error)
    }
  },
)

router.delete(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (req.user?.role !== 'landlord') {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can delete properties')
      }

      const existing = await landlordPropertyStore.getById(req.params.id)
      if (!existing) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }
      assertOwner(existing.landlordId, req)

      await landlordPropertyStore.delete(req.params.id)
      logger.info('Property deleted', { propertyId: req.params.id, landlordId: req.user.id })
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  },
)

export function createLandlordPropertiesRouter(): Router {
  return router
}
