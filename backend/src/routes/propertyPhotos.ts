import { Router, Response } from 'express'
import multer from 'multer'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { propertyPhotoStore } from '../models/propertyPhotoStore.js'
import { landlordPropertyStore } from '../models/landlordPropertyStore.js'
import { validate } from '../middleware/validate.js'
import {
  createPhotoSchema,
  updatePhotoSchema,
  reorderPhotosSchema,
  setFeaturedSchema,
  photoFiltersSchema,
} from '../schemas/propertyPhoto.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

const router = Router()

// Configure multer for file uploads
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/
    const extname = allowedTypes.test(file.mimetype)
    if (extname) {
      cb(null, true)
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, webp, gif) are allowed'))
    }
  },
})

/**
 * List photos for a property
 * GET /api/properties/:propertyId/photos
 */
router.get(
  '/properties/:propertyId/photos',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const property = await landlordPropertyStore.getById(req.params.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id && req.user?.role !== 'admin') {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to view these photos')
      }

      const filters = photoFiltersSchema.parse({ ...req.query, propertyId: req.params.propertyId })
      const photos = await propertyPhotoStore.list(filters)

      res.json(photos)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Get a single photo
 * GET /api/photos/:id
 */
router.get(
  '/photos/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const photo = await propertyPhotoStore.getById(req.params.id)
      if (!photo) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Photo not found')
      }

      const property = await landlordPropertyStore.getById(photo.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id && req.user?.role !== 'admin') {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to view this photo')
      }

      res.json(photo)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Upload a photo for a property
 * POST /api/properties/:propertyId/photos
 */
router.post(
  '/properties/:propertyId/photos',
  authenticateToken,
  upload.single('photo'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (!req.file) {
        throw new AppError(ErrorCode.BAD_REQUEST, 400, 'No photo file provided')
      }

      const property = await landlordPropertyStore.getById(req.params.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to upload photos to this property')
      }

      // In a real implementation, you would upload to a cloud storage service
      // For now, we'll use a placeholder URL or base64
      const base64 = req.file.buffer.toString('base64')
      const url = `data:${req.file.mimetype};base64,${base64}`

      // Get image dimensions if possible
      const dimensions = await getImageDimensions(req.file.buffer)

      const photo = await propertyPhotoStore.create({
        propertyId: req.params.propertyId,
        url,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        width: dimensions.width,
        height: dimensions.height,
        mimeType: req.file.mimetype,
      })

      logger.info('Photo uploaded', { photoId: photo.id, propertyId: req.params.propertyId, landlordId: req.user.id })
      res.status(201).json(photo)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Batch upload multiple photos
 * POST /api/properties/:propertyId/photos/batch
 */
router.post(
  '/properties/:propertyId/photos/batch',
  authenticateToken,
  upload.array('photos', 20),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const files = req.files as Express.Multer.File[]
      if (!files || files.length === 0) {
        throw new AppError(ErrorCode.BAD_REQUEST, 400, 'No photo files provided')
      }

      const property = await landlordPropertyStore.getById(req.params.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to upload photos to this property')
      }

      const results = []
      const errors = []

      for (const file of files) {
        try {
          const base64 = file.buffer.toString('base64')
          const url = `data:${file.mimetype};base64,${base64}`
          const dimensions = await getImageDimensions(file.buffer)

          const photo = await propertyPhotoStore.create({
            propertyId: req.params.propertyId,
            url,
            fileName: file.originalname,
            fileSize: file.size,
            width: dimensions.width,
            height: dimensions.height,
            mimeType: file.mimetype,
          })

          results.push({ success: true, photo })
        } catch (error) {
          errors.push({
            success: false,
            fileName: file.originalname,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      logger.info('Batch photo upload', { 
        propertyId: req.params.propertyId, 
        landlordId: req.user.id,
        successful: results.length,
        failed: errors.length,
      })

      res.status(201).json({
        results,
        errors,
        summary: {
          total: files.length,
          successful: results.length,
          failed: errors.length,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Update a photo
 * PATCH /api/photos/:id
 */
router.patch(
  '/photos/:id',
  authenticateToken,
  validate(updatePhotoSchema, 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const photo = await propertyPhotoStore.getById(req.params.id)
      if (!photo) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Photo not found')
      }

      const property = await landlordPropertyStore.getById(photo.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to update this photo')
      }

      const updated = await propertyPhotoStore.update(req.params.id, req.body as any)
      logger.info('Photo updated', { photoId: req.params.id, landlordId: req.user.id })
      res.json(updated)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Delete a photo
 * DELETE /api/photos/:id
 */
router.delete(
  '/photos/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const photo = await propertyPhotoStore.getById(req.params.id)
      if (!photo) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Photo not found')
      }

      const property = await landlordPropertyStore.getById(photo.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to delete this photo')
      }

      await propertyPhotoStore.delete(req.params.id)
      logger.info('Photo deleted', { photoId: req.params.id, landlordId: req.user.id })
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Reorder photos
 * POST /api/photos/reorder
 */
router.post(
  '/photos/reorder',
  authenticateToken,
  validate(reorderPhotosSchema, 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const photo = await propertyPhotoStore.getById(req.body.photoId)
      if (!photo) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Photo not found')
      }

      const property = await landlordPropertyStore.getById(photo.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to reorder these photos')
      }

      const reordered = await propertyPhotoStore.reorder(req.body as any)
      logger.info('Photos reordered', { propertyId: photo.propertyId, landlordId: req.user.id })
      res.json(reordered)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Set featured photo
 * POST /api/photos/set-featured
 */
router.post(
  '/photos/set-featured',
  authenticateToken,
  validate(setFeaturedSchema, 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const photo = await propertyPhotoStore.getById(req.body.photoId)
      if (!photo) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Photo not found')
      }

      const property = await landlordPropertyStore.getById(req.body.propertyId)
      if (!property) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Property not found')
      }

      if (property.landlordId !== req.user?.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You do not have permission to set featured photo')
      }

      const featured = await propertyPhotoStore.setFeatured(req.body.photoId, req.body.propertyId)
      logger.info('Featured photo set', { photoId: req.body.photoId, propertyId: req.body.propertyId, landlordId: req.user.id })
      res.json(featured)
    } catch (error) {
      next(error)
    }
  }
)

// Helper function to get image dimensions
async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  // Simple implementation - in production, use a proper image processing library
  // For now, return default dimensions
  return { width: 1920, height: 1080 }
}

export function createPropertyPhotosRouter(): Router {
  return router
}
