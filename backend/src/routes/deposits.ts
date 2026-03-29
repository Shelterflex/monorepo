import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { idempotency } from '../middleware/idempotency.js'
import { confirmDepositSchema, type ConfirmDepositRequest } from '../schemas/deposit.js'
import { depositStore } from '../models/depositStore.js'
import { ConversionService } from '../services/conversionService.js'
import { logger } from '../utils/logger.js'

export function createDepositsRouter(conversionService: ConversionService) {
  const router = Router()

  /**
   * POST /api/deposits/confirm
   *
   * Confirm a fiat (NGN) deposit. This is idempotent by depositId.
   * It immediately executes NGN -> USDC conversion (once per deposit) and returns the conversion.
   *
   * Requires `x-idempotency-key` header to prevent duplicate deposits from network retries.
   */
  router.post(
    '/confirm',
    idempotency(),
    validate(confirmDepositSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as ConfirmDepositRequest

        const deposit = await depositStore.confirm(body)

        const conversion = await conversionService.convertDeposit({
          depositId: deposit.depositId,
          userId: deposit.userId,
          amountNgn: deposit.amountNgn,
        })

        logger.info('Deposit confirmed and converted', {
          depositId: deposit.depositId,
          conversionId: conversion.conversionId,
          requestId: req.requestId,
        })

        res.status(200).json({
          success: true,
          deposit,
          conversion,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
