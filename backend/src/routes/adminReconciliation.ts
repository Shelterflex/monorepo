import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { requireAdminSecret } from '../middleware/adminSecret.js'
import { ngnDepositStore } from '../models/ngnDepositStore.js'
import { depositStore } from '../models/depositStore.js'
import { conversionStore } from '../models/conversionStore.js'
import { outboxStore, OutboxStatus } from '../outbox/index.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import {
  depositsQuerySchema,
  depositsResponseSchema,
  conversionsQuerySchema,
  conversionsResponseSchema,
  outboxQuerySchema,
  outboxResponseSchema,
  walletsQuerySchema,
  walletsResponseSchema,
} from '../schemas/adminReconciliation.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createAdminReconciliationRouter(ngnWalletService: NgnWalletService) {
  const router = Router()

  router.get(
    '/deposits',
    requireAdminSecret,
    validate(depositsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, limit: rawLimit, cursor: cursorStr } = req.query as any
        const limit = Math.max(1, Math.min(1000, Number(rawLimit ?? 50)))
        const cursorDate = cursorStr ? new Date(String(cursorStr)) : undefined
        const fetchLimit = limit

        const [ngn, staking] = await Promise.all([
          ngnDepositStore.listByStatus({
            status: status as any | undefined,
            limit: fetchLimit,
            cursorCreatedAt: cursorDate,
          }),
          depositStore.listInitiations({
            status: status as any | undefined,
            limit: fetchLimit,
            cursorCreatedAt: cursorDate,
          }),
        ])

        const merged = [
          ...ngn.map((d) => ({
            depositId: d.depositId,
            userId: d.userId,
            amountNgn: d.amountNgn,
            rail: d.rail ?? null,
            status: d.status,
            hasExternalRef: !!(d.externalRefSource && d.externalRef),
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            flow: 'ngn_wallet' as const,
          })),
          ...staking.map((d) => ({
            depositId: d.depositId,
            userId: d.userId,
            amountNgn: d.amountNgn,
            rail: d.paymentRail ?? null,
            status: d.status,
            hasExternalRef: !!(d.externalRefSource && d.externalRef),
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            flow: 'staking' as const,
          })),
        ]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit)

        const nextCursor =
          merged.length === limit ? merged[merged.length - 1].createdAt.toISOString() : null

        res.json(
          depositsResponseSchema.parse({
            items: merged.map((i) => ({
              ...i,
              createdAt: i.createdAt.toISOString(),
              updatedAt: i.updatedAt.toISOString(),
            })),
            nextCursor,
          }),
        )
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/wallets',
    requireAdminSecret,
    validate(walletsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { negative, limit: rawLimit, cursor } = req.query as any
        const limit = Math.max(1, Math.min(1000, Number(rawLimit ?? 50)))
        const includeNonNegative = !(negative === true || negative === 'true')

        const { items, nextCursor } = await ngnWalletService.listNegativeBalances({
          limit,
          cursor: cursor as string | undefined,
          includeNonNegative,
        })

        const withFrozen = await Promise.all(
          items.map(async (it: { userId: string; balance: any }) => {
            const risk = await userRiskStateStore.getByUserId(it.userId)
            return {
              userId: it.userId,
              availableNgn: it.balance.availableNgn,
              heldNgn: it.balance.heldNgn,
              totalNgn: it.balance.totalNgn,
              isFrozen: risk?.isFrozen ?? false,
            }
          }),
        )

        res.json(
          walletsResponseSchema.parse({
            items: withFrozen,
            nextCursor,
          }),
        )
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/conversions',
    requireAdminSecret,
    validate(conversionsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, limit: rawLimit, cursor: cursorStr } = req.query as any
        const limit = Math.max(1, Math.min(1000, Number(rawLimit ?? 50)))
        const cursorDate = cursorStr ? new Date(String(cursorStr)) : undefined

        const items = await conversionStore.listByStatus({
          status: status as any | undefined,
          limit,
          cursorCreatedAt: cursorDate,
        })

        const mapped = items.map((r) => ({
          conversionId: r.conversionId,
          depositId: r.depositId,
          userId: r.userId,
          amountNgn: r.amountNgn,
          amountUsdc: r.amountUsdc,
          fxRateNgnPerUsdc: r.fxRateNgnPerUsdc,
          provider: r.provider,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          failedAt: r.failedAt ? r.failedAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          failureReason: r.failureReason ?? null,
        }))

        const nextCursor =
          items.length === limit ? items[items.length - 1].createdAt.toISOString() : null

        res.json(conversionsResponseSchema.parse({ items: mapped, nextCursor }))
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/outbox',
    requireAdminSecret,
    validate(outboxQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, limit: rawLimit, cursor: cursorStr } = req.query as any
        const limit = Math.max(1, Math.min(1000, Number(rawLimit ?? 50)))
        const cursorDate = cursorStr ? new Date(String(cursorStr)) : undefined

        let items =
          status != null
            ? await outboxStore.listByStatus(status as OutboxStatus)
            : await outboxStore.listAll(limit * 2)

        items = items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        if (cursorDate) {
          items = items.filter((i) => i.createdAt < cursorDate)
        }
        const slice = items.slice(0, limit)
        const nextCursor =
          slice.length === limit ? slice[slice.length - 1].createdAt.toISOString() : null

        const mapped = slice.map((i) => ({
          id: i.id,
          txType: i.txType,
          txId: i.txId,
          externalRef: i.canonicalExternalRefV1,
          status: i.status,
          attempts: i.attempts,
          lastError: i.lastError,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
        }))

        res.json(outboxResponseSchema.parse({ items: mapped, nextCursor }))
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

