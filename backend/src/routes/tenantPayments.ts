/**
 * Tenant Payments Routes
 * Uses durable idempotency for quick-pay and wallet top-up initiation.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { authenticateToken, type AuthenticatedRequest } from "../middleware/auth.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { NgnWalletService } from "../services/ngnWalletService.js";
import { durableIdempotency } from "../middleware/durableIdempotency.js";
import { validate } from "../middleware/validate.js";
import { ngnTopupInitiateSchema, ngnTopupInitiateResponseSchema } from "../schemas/ngnTopup.js";
import type { NgnTopupInitiateRequest } from "../schemas/ngnTopup.js";
import { initiateNgnTopup } from "../services/ngnTopupInitiateService.js";
import { generateId } from "../utils/tokens.js";
import { logger } from "../utils/logger.js";
import { deriveInstalmentStatus, type InstalmentInput } from "../utils/installmentSchedule.js";

const router = Router();
const ngnWalletService = new NgnWalletService();

function escapePdfString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildReceiptPdf(reference: string, amount: number, paidDate: string) {
  const lines = [
    "%PDF-1.1",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "endobj",
    "4 0 obj",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "endobj",
  ]

  const textLines = [
    `Receipt Reference: ${escapePdfString(reference)}`,
    `Amount: NGN ${amount.toLocaleString("en-NG")}`,
    `Paid Date: ${escapePdfString(paidDate)}`,
  ]

  const content = [`BT /F1 12 Tf 40 740 Td (${escapePdfString(textLines[0])}) Tj`]
    .concat(
      textLines.slice(1).map((line) => `0 -18 Td (${escapePdfString(line)}) Tj`),
    )
    .concat(["ET"])
    .join("\n")

  const contentBuffer = Buffer.from(content, "latin1")
  lines.push("5 0 obj")
  lines.push(`<< /Length ${contentBuffer.length} >>`)
  lines.push("stream")
  lines.push(content)
  lines.push("endstream")
  lines.push("endobj")

  const header = lines.join("\n") + "\n"
  let position = 0
  const positions = lines.map((line) => {
    const offset = position
    position += Buffer.byteLength(line + "\n", "latin1")
    return offset
  })

  const xrefLines = ["xref", "0 6", "0000000000 65535 f"]
  for (let i = 0; i < 5; i++) {
    xrefLines.push(`${positions[i].toString().padStart(10, "0")} 00000 n`)
  }

  const trailer = [
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    position.toString(),
    "%%EOF",
  ].join("\n")

  return Buffer.concat([Buffer.from(header, "latin1"), Buffer.from(trailer, "latin1")])
}

function getMockTenantDeals() {
  return [
    { dealId: "deal-1", leaseName: "Jade Apartments - Unit 3A" },
    { dealId: "deal-2", leaseName: "Harbor View Studios - Unit 7B" },
  ]
}

function formatIsoDate(date: Date) {
  return date.toISOString().split("T")[0]
}

function getMockPaymentSchedule(dealId: string) {
  const now = new Date()
  const amounts = dealId === "deal-2" ? [145000, 145000, 145000, 145000, 145000] : [120000, 120000, 120000, 120000, 120000]
  
  const instalments: InstalmentInput[] = amounts.map((amount, index) => {
    const dueDate = new Date(now)
    dueDate.setDate(now.getDate() + (index - 1) * 30)
    const isPast = dueDate < now
    const paid = isPast && index !== 0
    return {
      period: index + 1,
      dueDate: dueDate.toISOString(),
      amountNgn: amount,
      paid,
      paidAt: paid ? new Date(dueDate.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() : null,
    }
  })
  
  const schedule = instalments.map((instalment) => {
    const status = deriveInstalmentStatus(instalment, now)
    const dueDate = new Date(instalment.dueDate)
    return {
      period: instalment.period,
      month: dueDate.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      amount: instalment.amountNgn,
      dueDate: formatIsoDate(dueDate),
      status,
      paidDate: instalment.paidAt ? formatIsoDate(new Date(instalment.paidAt)) : undefined,
      isNextDue: instalment.period === 2,
    }
  })
  
  return schedule
}

function getMockPaymentHistory(dealId: string) {
  const now = new Date()
  const base = [
    {
      id: "payment-01",
      dealId,
      reference: "REF-17290",
      amount: 120000,
      status: "paid",
      transactionDate: formatIsoDate(new Date(now.getTime() - 55 * 24 * 60 * 60 * 1000)),
      paidDate: formatIsoDate(new Date(now.getTime() - 54 * 24 * 60 * 60 * 1000)),
      method: "card",
      isOverdue: false,
      daysOverdue: 0,
    },
    {
      id: "payment-02",
      dealId,
      reference: "REF-17291",
      amount: 120000,
      status: "overdue",
      transactionDate: formatIsoDate(new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000)),
      paidDate: undefined,
      method: "card",
      isOverdue: true,
      daysOverdue: 10,
    },
    {
      id: "payment-03",
      dealId,
      reference: "REF-17292",
      amount: 120000,
      status: "paid",
      transactionDate: formatIsoDate(new Date(now.getTime() - 85 * 24 * 60 * 60 * 1000)),
      paidDate: formatIsoDate(new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000)),
      method: "wallet",
      isOverdue: false,
      daysOverdue: 0,
    },
  ]
  return base
}

router.get(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, "User not authenticated")
      }

      const dealId = (req.query.dealId as string) || getMockTenantDeals()[0].dealId
      const page = Number(req.query.page ?? 1)
      const limit = Number(req.query.limit ?? 10)
      const allPayments = getMockPaymentHistory(dealId)
      const start = (page - 1) * limit
      const payments = allPayments.slice(start, start + limit)

      res.json({
        success: true,
        data: {
          payments,
          page,
          limit,
          total: allPayments.length,
          nextPage: start + limit < allPayments.length ? page + 1 : undefined,
          deals: getMockTenantDeals(),
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  "/receipt/:reference",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, "User not authenticated")
      }

      const reference = req.params.reference
      const pdf = buildReceiptPdf(reference, 120000, formatIsoDate(new Date()))
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `inline; filename=receipt-${reference}.pdf`)
      res.send(pdf)
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  "/schedule",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, "User not authenticated");
      }

      const dealId = (req.query.dealId as string) || getMockTenantDeals()[0].dealId;
      const schedule = getMockPaymentSchedule(dealId);
      const nextPayment = schedule.find((item) => item.status === "upcoming") || null;

      res.json({
        success: true,
        data: {
          schedule,
          nextPayment,
          dealId,
          deals: getMockTenantDeals(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/history",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (!req.user?.id) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, "User not authenticated");
      }

      const dealId = (req.query.dealId as string) || getMockTenantDeals()[0].dealId;
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 10);
      const allPayments = getMockPaymentHistory(dealId);
      const start = (page - 1) * limit;

      res.json({
        success: true,
        data: {
          payments: allPayments.slice(start, start + limit),
          page,
          limit,
          total: allPayments.length,
          nextPage: start + limit < allPayments.length ? page + 1 : undefined,
          deals: getMockTenantDeals(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/wallet",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, "User not authenticated");
      }
      const balance = await ngnWalletService.getBalance(userId);
      res.json({
        success: true,
        data: {
          balance: balance.availableNgn,
          availableNgn: balance.availableNgn,
          heldNgn: balance.heldNgn,
          totalNgn: balance.totalNgn,
          lastTopUp: new Date().toISOString(),
          autoPayEnabled: true,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

const quickPaySchema = z.object({
  dealId: z.string().describe("Deal ID to pay for"),
  amount: z.number().positive().describe("Amount to pay in NGN"),
  paymentMethod: z.enum(["wallet", "card"]).describe("Payment method"),
});

router.post(
  "/quick-pay",
  authenticateToken,
  durableIdempotency((req) => `tenant:${(req as AuthenticatedRequest).user!.id}:quick-pay`),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, "User not authenticated");
      }
      const validated = quickPaySchema.parse(req.body);
      const paymentId = generateId();
      res.json({
        success: true,
        data: {
          paymentId,
          status: "pending" as const,
          amount: validated.amount,
          method: validated.paymentMethod,
          dealId: validated.dealId,
          message: "Payment initiated",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message));
      }
      next(error);
    }
  },
);

const topUpBodySchema = z
  .object({
    amount: z.number().positive().min(1000).describe("Amount to top up in NGN"),
    paymentMethod: z.enum(["card", "bank_transfer"]).default("card").describe("Top-up method"),
  })
  .transform(
    (v): NgnTopupInitiateRequest => ({
      amountNgn: v.amount,
      rail: v.paymentMethod === "bank_transfer" ? "bank_transfer" : "paystack",
    }),
  );

router.post(
  '/wallet/topup',
  authenticateToken,
  validate(topUpBodySchema, 'body'),
  durableIdempotency((req) => `tenant:${(req as AuthenticatedRequest).user!.id}:wallet-topup`),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }
      const body = req.body as NgnTopupInitiateRequest
      const idempotencyKeyRaw = req.header('x-idempotency-key')
      const idempotencyKey =
        typeof idempotencyKeyRaw === 'string' && idempotencyKeyRaw.trim() !== ''
          ? idempotencyKeyRaw.trim()
          : null
      if (!idempotencyKey) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Missing x-idempotency-key for top-up (required with durable idempotency)',
        )
      }
      const ngnBody = ngnTopupInitiateSchema.parse(body)
      const { status, body: out } = await initiateNgnTopup({
        userId,
        body: ngnBody,
        idempotencyKey,
        requestId: req.requestId,
      })
      res.status(status).json(ngnTopupInitiateResponseSchema.parse(out))
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.status).json({ error: { code: error.code, message: error.message } })
      }
      next(error)
    }
  },
)

router.get(
  '/disputes',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      const { paymentDisputeRepository } = await import('../repositories/PaymentDisputeRepository.js')
      const disputes = await paymentDisputeRepository.findByUserId(userId)

      res.json({
        success: true,
        data: { disputes },
      })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/disputes',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      const { paymentDisputeCreateSchema } = await import('../schemas/paymentDispute.js')
      const parsed = paymentDisputeCreateSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid dispute data')
      }

      const { paymentDisputeRepository } = await import('../repositories/PaymentDisputeRepository.js')
      const dispute = await paymentDisputeRepository.create(userId, parsed.data)

      const { enqueueChallengeRentRelease } = await import('../services/disputes/rentReleaseSync.js')
      enqueueChallengeRentRelease(dispute).catch((err) =>
        logger.error('Failed to enqueue challenge_rent_release for dispute:', err),
      )

      res.status(201).json({
        success: true,
        data: { dispute },
      })
    } catch (error) {
      next(error)
    }
  },
)

export function createTenantPaymentsRouter(): Router {
  return router;
}
