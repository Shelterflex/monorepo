import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { creditScoreSchema, overrideSchema, configSchema, riskBandSchema } from '../schemas/creditScoring.js'
import { TenantCreditScoringService } from '../services/tenantCreditScoringService.js'
import { tenantCreditScoreStore } from '../models/tenantCreditScoreStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'

const scoringService = new TenantCreditScoringService()

export function createTenantCreditScoringRouter() {
  const router = Router()

  function requireAdminOrCompliance(req: Request): AuthenticatedRequest {
    const user = (req as any).user
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
    }
    if (user.role !== 'admin' && user.role !== 'compliance' && user.role !== 'super_admin') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin or compliance role required')
    }
    return user
  }

  router.post(
    '/score',
    authenticateToken,
    validate(creditScoreSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireAdminOrCompliance(req)
        const { tenantId, paymentHistoryScore, applicationDataScore, behavioralScore } =
          req.body as any

        // Build factor inputs from request
        const factorInputs: Record<string, number> = {}
        if (paymentHistoryScore !== undefined) factorInputs.paymentHistory = paymentHistoryScore
        if (applicationDataScore !== undefined) factorInputs.applicationData = applicationDataScore
        if (behavioralScore !== undefined) factorInputs.behavioralSignals = behavioralScore

        // Add default values for missing factors
        const config = tenantCreditScoreStore.getConfig()
        for (const factor of config.factorWeights) {
          if (factorInputs[factor.factorName] === undefined) {
            factorInputs[factor.factorName] = 50 // default middle score
          }
        }

        const record = scoringService.scoreTenant(tenantId, factorInputs)

        auditLog(
          'TENANT_CREDIT_SCORED' as any,
          extractAuditContext(req, user.role as any),
          {
            tenantId,
            score: record.computedScore,
            riskBand: record.riskBand,
            recordId: record.id,
          },
        )

        res.status(201).json({
          id: record.id,
          tenantId: record.tenantId,
          computedScore: record.computedScore,
          riskBand: record.riskBand,
          factorInputs: record.factorInputs,
          factorWeights: record.factorWeights,
          triggeredRules: record.triggeredRules,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/score/:tenantId',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireAdminOrCompliance(req)
        const { tenantId } = req.params

        const record = scoringService.getTenantScore(tenantId)
        if (!record) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Credit score record not found for tenant')
        }

        auditLog(
          'TENANT_CREDIT_SCORE_ACCESSED' as any,
          extractAuditContext(req, user.role as any),
          { tenantId, recordId: record.id },
        )

        res.json({
          id: record.id,
          tenantId: record.tenantId,
          computedScore: record.computedScore,
          riskBand: record.riskBand,
          factorInputs: record.factorInputs,
          factorWeights: record.factorWeights,
          triggeredRules: record.triggeredRules,
          manualOverride: record.manualOverride,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/override',
    authenticateToken,
    validate(overrideSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireAdminOrCompliance(req)
        const { tenantId, manualScore, reason } = req.body as any

        const record = scoringService.overrideScore(
          tenantId,
          manualScore,
          reason,
          user.id,
        )

        auditLog(
          'TENANT_CREDIT_OVERRIDE' as any,
          extractAuditContext(req, user.role as any),
          {
            tenantId,
            recordId: record.id,
            manualScore,
            reason,
            overriddenBy: user.id,
          },
        )

        res.json({
          id: record.id,
          tenantId: record.tenantId,
          computedScore: record.computedScore,
          riskBand: record.riskBand,
          manualOverride: record.manualOverride,
          updatedAt: record.updatedAt.toISOString(),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/config',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        requireAdminOrCompliance(req)

        const config = scoringService.getConfig()
        res.json(config)
      } catch (error) {
        next(error)
      }
    },
  )

  router.put(
    '/config',
    authenticateToken,
    validate(configSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireAdminOrCompliance(req)
        const { factorWeights, riskBandThresholds } = req.body as any

        scoringService.updateConfig(factorWeights, riskBandThresholds)

        auditLog(
          'TENANT_CREDIT_CONFIG_UPDATED' as any,
          extractAuditContext(req, user.role as any),
          { factorWeights, riskBandThresholds },
        )

        res.json({ success: true, config: scoringService.getConfig() })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        requireAdminOrCompliance(req)

        const tenantId = req.query.tenantId as string | undefined
        const riskBand = req.query.riskBand as any | undefined
        const minScore = req.query.minScore ? Number(req.query.minScore) : undefined
        const maxScore = req.query.maxScore ? Number(req.query.maxScore) : undefined
        const page = Number(req.query.page) || 1
        const pageSize = Number(req.query.pageSize) || 20

        const result = tenantCreditScoreStore.search({
          tenantId,
          riskBand,
          minScore,
          maxScore,
          page,
          pageSize,
        })

        res.json({
          records: result.records.map((r) => ({
            id: r.id,
            tenantId: r.tenantId,
            computedScore: r.computedScore,
            riskBand: r.riskBand,
            factorInputs: r.factorInputs,
            manualOverride: r.manualOverride,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
          pagination: {
            total: result.total,
            page,
            pageSize,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
