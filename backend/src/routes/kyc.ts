import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { kycSubmissionSchema, kycStatusSchema } from '../schemas/kyc.js'
import { kycRepository, MAX_ATTEMPTS } from '../repositories/KycRepository.js'
import { PostgresUserRepository } from '../repositories/AuthRepository.js'
import { createKycProvider } from '../services/kycProvider.js'
import { authenticateToken } from '../middleware/auth.js'
import { requirePermission } from '../middleware/rbac.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext, type AuditEventType } from '../utils/auditLogger.js'
import { verifyHmacSha256 } from '../utils/webhookSignature.js'
import { emitKycStatusChanged } from '../services/index.js'
import { logger } from '../utils/logger.js'
import { recordKycSubmission } from '../metrics.js'
import { outboxStore, TxType } from '../outbox/index.js'
import { createSorobanAdapter, getSorobanConfigFromEnv } from '../soroban/index.js'

const router = Router()
const kycProvider = createKycProvider()

router.post(
  '/',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = kycSubmissionSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid submission')
      }

      const userId = (req as any).user.id as string
      const submission = parsed.data

      const existing = await kycRepository.findByUserId(userId)
      if (existing && existing.status === 'pending') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC already pending')
      }
      if (existing && existing.status === 'in_review') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC currently in review')
      }
      if (existing && existing.attemptCount >= MAX_ATTEMPTS) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC_MAX_ATTEMPTS_REACHED', {
          attemptsRemaining: 0,
          maxAttempts: MAX_ATTEMPTS,
        })
      }

      let record
      try {
        record = await kycRepository.create(userId, submission)
      } catch (err: any) {
        if (err.message === 'MAX_ATTEMPTS_EXCEEDED') {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC_MAX_ATTEMPTS_REACHED', {
            attemptsRemaining: 0,
            maxAttempts: MAX_ATTEMPTS,
          })
        }
        throw err
      }

      try {
        const result = await kycProvider.submit(submission)
        if (result.success && result.externalId) {
          await kycRepository.updateStatus(
            record.id,
            'in_review',
            kycProvider.name,
            result.externalId,
          )
        }
      } catch (providerError) {
        logger.warn('kyc.provider_error', { error: providerError })
      }

      auditLog('KYC_SUBMITTED' as AuditEventType, extractAuditContext(req, 'user'), {
        recordId: record.id,
        documentType: submission.documentType,
        attemptCount: record.attemptCount,
      })

      recordKycSubmission(record.status)

      res.status(201).json({
        success: true,
        recordId: record.id,
        attemptsRemaining: MAX_ATTEMPTS - record.attemptCount,
      })
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/status',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user.id as string
      const record = await kycRepository.findByUserId(userId)

      if (!record) {
        return res.json({ status: 'not_submitted', attemptsRemaining: MAX_ATTEMPTS })
      }

      res.json({
        status: record.status,
        documentType: record.documentType,
        rejectionReason: record.rejectionReason,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - record.attemptCount),
      })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body

      if (!kycProvider.webhookAuthenticate(payload)) {
        logger.warn('kyc.webhook_unauthorized', { payload })
        return next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized'))
      }

      const { id, status, reason } = payload as { id: string; status: string; reason?: string }
      const record = await kycRepository.findById(id)

      if (!record) {
        logger.warn('kyc.webhook_record_not_found', { id })
        return next(new AppError(ErrorCode.NOT_FOUND, 404, 'Not found'))
      }

      const newStatus = kycStatusSchema.parse(status)
      await kycRepository.updateStatus(record.id, newStatus, undefined, undefined, reason)

      await emitKycStatusChanged(record.userId, newStatus)

      res.json({ received: true })
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/admin',
  authenticateToken,
  requirePermission('kyc', 'view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, userId, page, pageSize } = req.query
      const result = await kycRepository.list({
        status: status as any,
        userId: userId as string,
        page: parseInt(page as string) || 1,
        pageSize: parseInt(pageSize as string) || 50,
      })

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/admin/:submissionId',
  authenticateToken,
  requirePermission('kyc', 'view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { submissionId } = req.params
      const record = await kycRepository.findById(submissionId)

      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'KYC record not found')
      }

      res.json({ success: true, data: record })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/admin/:recordId/approve',
  authenticateToken,
  requirePermission('kyc', 'verify'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { recordId } = req.params
      const adminId = (req as any).user.id as string
      const { reason } = req.body as { reason?: string }

      const record = await kycRepository.findById(recordId)
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'KYC record not found')
      }

      if (record.status !== 'pending' && record.status !== 'in_review') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Cannot approve in current state')
      }

      await kycRepository.updateStatus(recordId, 'approved', undefined, undefined, reason, adminId)

      auditLog('KYC_APPROVED' as AuditEventType, extractAuditContext(req, 'admin'), {
        recordId,
        userId: record.userId,
      })

      await emitKycStatusChanged(record.userId, 'approved')

      // Enqueue allowlist add operation for on-chain recording
      const authRepository = new PostgresUserRepository()
      const user = await authRepository.getById(record.userId)
      if (user?.walletAddress) {
        await outboxStore.create({
          txType: TxType.ALLOWLIST_ADD,
          source: 'kyc_approval',
          ref: recordId,
          payload: {
            address: user.walletAddress,
            label: 'approved',
          },
          aggregateId: record.userId,
          aggregateType: 'user',
          eventType: 'KYC_APPROVED',
          requestId: (req as any).requestId,
        })
        logger.info('Allowlist add enqueued for KYC approval', {
          outboxRef: recordId,
          userId: record.userId,
          address: user.walletAddress,
        })
      } else {
        logger.warn('User has no wallet address, skipping allowlist add', {
          userId: record.userId,
          kycId: recordId,
        })
      }

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/admin/:recordId/reject',
  authenticateToken,
  requirePermission('kyc', 'verify'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { recordId } = req.params
      const adminId = (req as any).user.id as string
      const { reason } = req.body as { reason?: string }

      const record = await kycRepository.findById(recordId)
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'KYC record not found')
      }

      if (record.status !== 'pending' && record.status !== 'in_review') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Cannot reject in current state')
      }

      await kycRepository.updateStatus(recordId, 'rejected', undefined, undefined, reason, adminId)

      auditLog('KYC_REJECTED' as AuditEventType, extractAuditContext(req, 'admin'), {
        recordId,
        userId: record.userId,
        reason,
      })

      await emitKycStatusChanged(record.userId, 'rejected')

      // Enqueue allowlist remove operation for on-chain recording
      const authRepository = new PostgresUserRepository()
      const user = await authRepository.getById(record.userId)
      if (user?.walletAddress) {
        await outboxStore.create({
          txType: TxType.ALLOWLIST_REMOVE,
          source: 'kyc_rejection',
          ref: recordId,
          payload: {
            address: user.walletAddress,
          },
          aggregateId: record.userId,
          aggregateType: 'user',
          eventType: 'KYC_REJECTED',
          requestId: (req as any).requestId,
        })
        logger.info('Allowlist remove enqueued for KYC rejection', {
          outboxRef: recordId,
          userId: record.userId,
          address: user.walletAddress,
        })
      } else {
        logger.warn('User has no wallet address, skipping allowlist remove', {
          userId: record.userId,
          kycId: recordId,
        })
      }

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/admin/:recordId/allowlist-status',
  authenticateToken,
  requirePermission('kyc', 'verify'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { recordId } = req.params

      const record = await kycRepository.findById(recordId)
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'KYC record not found')
      }

      const authRepository = new PostgresUserRepository()
      const user = await authRepository.getById(record.userId)
      
      if (!user?.walletAddress) {
        return res.json({
          success: true,
          data: {
            isAllowlisted: false,
            hasWalletAddress: false,
            walletAddress: null,
            entry: null,
          },
        })
      }

      const sorobanConfig = getSorobanConfigFromEnv(process.env)
      const sorobanAdapter = createSorobanAdapter(sorobanConfig)
      
      const isAllowlisted = sorobanAdapter.isAllowlisted ? await sorobanAdapter.isAllowlisted(user.walletAddress) : false
      const entry = sorobanAdapter.getAllowlistEntry ? await sorobanAdapter.getAllowlistEntry(user.walletAddress) : null

      res.json({
        success: true,
        data: {
          isAllowlisted,
          hasWalletAddress: true,
          walletAddress: user.walletAddress,
          entry,
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

export function createKycRouter(): Router {
  return router
}

/**
 * Standalone router for provider-specific KYC webhooks.
 * Mount at /api/webhooks/kyc → handles POST /api/webhooks/kyc/:provider
 */
export function createKycWebhookRouter(): Router {
  const webhookRouter = Router()
  webhookRouter.post('/:provider', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.params
      const rawBody = JSON.stringify(req.body)
      const signature = (req.headers['x-signature'] || req.headers['x-webhook-signature']) as string | undefined

      const secret = process.env[`KYC_WEBHOOK_SECRET_${provider.toUpperCase()}`]
        || process.env.KYC_WEBHOOK_SECRET
        || ''

      if (secret) {
        if (!signature) {
          logger.warn('kyc.provider_webhook_missing_signature', { provider })
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Missing signature')
        }
        if (!verifyHmacSha256(secret, rawBody, signature)) {
          logger.warn('kyc.provider_webhook_invalid_signature', { provider })
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid signature')
        }
      }

      // Respond 200 immediately; process asynchronously
      res.json({ received: true })

      const payload = req.body as Record<string, unknown>
      const id = (payload.id ?? payload.external_id ?? payload.reference) as string | undefined
      const status = payload.status as string | undefined
      const reason = payload.reason as string | undefined

      if (!id || !status) {
        logger.warn('kyc.provider_webhook_missing_fields', { provider, payload })
        return
      }

      const record = await kycRepository.findById(id).catch(() => null)
      if (!record) {
        logger.warn('kyc.provider_webhook_record_not_found', { provider, id })
        return
      }

      const parsed = kycStatusSchema.safeParse(status)
      if (!parsed.success) {
        logger.warn('kyc.provider_webhook_unknown_status', { provider, status })
        return
      }

      await kycRepository.updateStatus(record.id, parsed.data, provider, undefined, reason)
      await emitKycStatusChanged(record.userId, parsed.data)
    } catch (error) {
      // Only pass to error handler if we haven't already sent a response
      if (!res.headersSent) {
        next(error)
      } else {
        logger.error('kyc.provider_webhook_error', { error })
      }
    }
  })
  return webhookRouter
}
