import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { withdrawalResponseSchema } from '../schemas/ngnWallet.js'
import { AppError } from '../errors/AppError.js'
import { logger } from '../utils/logger.js'

const rejectWithdrawalSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
})

export function createAdminWithdrawalsRouter(ngnWalletService: NgnWalletService): Router {
  const router = Router()

  router.post(
    '/withdrawals/:id/approve',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const withdrawal = await ngnWalletService.approveWithdrawal(id)
        
        logger.info('Withdrawal approved by admin', {
          adminId: req.user!.id,
          withdrawalId: id,
          requestId: req.requestId,
        })

        res.json(withdrawalResponseSchema.parse({ success: true, ...withdrawal }))
      } catch (error) {
        if (error instanceof AppError) {
          res.status(error.status).json({ error: { code: error.code, message: error.message } })
        } else {
          next(error)
        }
      }
    },
  )

  router.post(
    '/withdrawals/:id/reject',
    authenticateToken,
    validate(rejectWithdrawalSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const { reason } = req.body as { reason: string }
        const withdrawal = await ngnWalletService.rejectWithdrawal(id, reason)

        logger.info('Withdrawal rejected by admin', {
          adminId: req.user!.id,
          withdrawalId: id,
          reason,
          requestId: req.requestId,
        })

        res.json(withdrawalResponseSchema.parse({ success: true, ...withdrawal }))
      } catch (error) {
        if (error instanceof AppError) {
          res.status(error.status).json({ error: { code: error.code, message: error.message } })
        } else {
          next(error)
        }
      }
    },
  )

  return router
}
