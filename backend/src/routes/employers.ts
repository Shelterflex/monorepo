import { Router, type Request, type Response, type NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { assertAdminSecret as requireAdminSecret } from '../middleware/adminSecret.js'
import { employerStore } from '../models/employerStore.js'
import {
  createEmployerSchema,
  deductionNotifySchema,
  employerListQuerySchema,
  employerSearchQuerySchema,
} from '../schemas/employer.js'
import {
  requireEmployerApiKey,
  type EmployerAuthenticatedRequest,
} from '../middleware/employerApiKey.js'
import { processEmployerDeductionNotification } from '../services/salaryDeductionService.js'

export function createEmployersRouter(): Router {
  const router = Router()

  router.post('/admin/employers', (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)
      const body = createEmployerSchema.parse(req.body)
      const { employer, apiKey } = employerStore.create(body)
      res.status(201).json({ success: true, data: { employer, apiKey } })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  })

  router.get('/admin/employers', (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)
      const { status } = employerListQuerySchema.parse(req.query)
      const employers = employerStore.list(status)
      res.json({ success: true, data: employers })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  })

  router.patch('/admin/employers/:id/activate', (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)
      const employer = employerStore.activate(req.params.id)
      if (!employer) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Employer not found')
      }
      res.json({ success: true, data: employer })
    } catch (error) {
      next(error)
    }
  })

  router.get('/employers/search', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = employerSearchQuerySchema.parse(req.query)
      const results = employerStore.searchActiveByName(name ?? '')
      res.json({ success: true, data: results })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  })

  router.post(
    '/employers/deductions/notify',
    requireEmployerApiKey,
    async (req: EmployerAuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const body = deductionNotifySchema.parse(req.body)
        const result = await processEmployerDeductionNotification({
          employerId: req.employer!.id,
          employeeId: body.employeeId,
          amount: body.amount,
          periodMonth: body.periodMonth,
          periodYear: body.periodYear,
          referenceId: body.referenceId,
        })
        res.json({ success: true, data: result })
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
        }
        next(error)
      }
    },
  )

  router.get(
    '/employers/:id',
    requireEmployerApiKey,
    (req: EmployerAuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (req.employer!.id !== req.params.id) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Cannot access another employer record')
        }
        const employer = employerStore.findById(req.params.id)
        if (!employer) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Employer not found')
        }
        res.json({
          success: true,
          data: {
            id: employer.id,
            name: employer.name,
            registrationNumber: employer.registrationNumber,
            contactEmail: employer.contactEmail,
            contactPhone: employer.contactPhone,
            status: employer.status,
            monthlyDeductionWebhookUrl: employer.monthlyDeductionWebhookUrl,
            verifiedAt: employer.verifiedAt?.toISOString(),
            createdAt: employer.createdAt.toISOString(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
