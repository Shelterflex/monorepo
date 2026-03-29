import { Router, Request, Response, NextFunction } from 'express'
import { ReceiptRepository } from '../indexer/receipt-repository.js'
import { TxType } from '../outbox/types.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken } from '../middleware/auth.js'

const VALID_TX_TYPES = new Set(Object.values(TxType))

/**
 * @openapi
 * /api/admin/receipts:
 *   get:
 *     summary: Query indexed receipts (no Soroban call)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dealId,      schema: { type: string } }
 *       - { in: query, name: txType,      schema: { type: string } }
 *       - { in: query, name: fromAddress, schema: { type: string } }
 *       - { in: query, name: toAddress,   schema: { type: string } }
 *       - { in: query, name: fromDate,    schema: { type: string, format: date-time } }
 *       - { in: query, name: toDate,      schema: { type: string, format: date-time } }
 *       - { in: query, name: page,        schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize,    schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200: { description: Paged receipts }
 *       400: { description: Invalid query parameter }
 *       401: { description: Unauthorized }
 * /api/deals/{dealId}/receipts:
 *   get:
 *     summary: All receipts for a deal
 *     tags: [Deals]
 *     parameters:
 *       - { in: path, name: dealId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Receipt list }
 */
export function createReceiptsRouter(repo: ReceiptRepository): Router {
  const router = Router()

  router.get(
    '/admin/receipts',
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20))
        const dealId = req.query.dealId as string | undefined
        const rawTxType = req.query.txType as string | undefined
        const fromAddress = req.query.fromAddress as string | undefined
        const toAddress = req.query.toAddress as string | undefined
        const rawFromDate = req.query.fromDate as string | undefined
        const rawToDate = req.query.toDate as string | undefined

        if (rawTxType !== undefined && !VALID_TX_TYPES.has(rawTxType as TxType)) {
          return next(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              400,
              `Invalid txType. Must be one of: ${[...VALID_TX_TYPES].join(', ')}`,
            ),
          )
        }

        let fromDate: Date | undefined
        if (rawFromDate !== undefined) {
          fromDate = new Date(rawFromDate)
          if (isNaN(fromDate.getTime())) {
            return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid fromDate — must be ISO 8601'))
          }
        }

        let toDate: Date | undefined
        if (rawToDate !== undefined) {
          toDate = new Date(rawToDate)
          if (isNaN(toDate.getTime())) {
            return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid toDate — must be ISO 8601'))
          }
        }

        if (fromDate && toDate && fromDate > toDate) {
          return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'fromDate must not be after toDate'))
        }

        const txType = rawTxType as TxType | undefined
        res.json(await repo.query({ dealId, txType, fromAddress, toAddress, fromDate, toDate, page, pageSize }))
      } catch (err) {
        next(err)
      }
    },
  )

  router.get('/deals/:dealId/receipts', async (req: Request, res: Response, next: NextFunction) => {
    const { dealId } = req.params
    if (!dealId) return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'dealId is required'))
    try {
      const receipts = await repo.findByDealId(dealId)
      res.json({ dealId, receipts, total: receipts.length })
    } catch (err) {
      next(err)
    }
  })

  return router
}