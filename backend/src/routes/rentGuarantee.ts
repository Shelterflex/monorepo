import { Router } from "express";
import { getPool } from "../db.js";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import type {
  RentGuaranteeProvider,
  InsurancePolicy,
} from "../services/insurance/RentGuaranteeProvider.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { auditLog, extractAuditContext } from "../utils/auditLogger.js";
import { idempotency } from "../middleware/idempotency.js";
import { insuranceClaimBodySchema } from "../schemas/rentGuarantee.js";

interface PolicyRow {
  id: string;
  deal_id: string;
  landlord_id: string;
  provider: string;
  policy_number: string;
  premium_ngn: string | number;
  coverage_term_months: number;
  status: string;
  created_at: Date;
}

function mapPolicyRow(row: PolicyRow): InsurancePolicy {
  return {
    policyNumber: row.policy_number,
    dealId: row.deal_id,
    landlordId: row.landlord_id,
    provider: row.provider,
    premiumNgn:
      typeof row.premium_ngn === "number"
        ? row.premium_ngn
        : Number(row.premium_ngn),
    coverageTermMonths: row.coverage_term_months,
    status: row.status as InsurancePolicy["status"],
    createdAt: new Date(row.created_at),
  };
}

export function createRentGuaranteeRouter(
  provider: RentGuaranteeProvider,
): Router {
  const router = Router();

  async function pool() {
    const p = await getPool();
    if (!p)
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        500,
        "Database pool not available",
      );
    return p;
  }

  function assertLandlordOrAdmin(req: AuthenticatedRequest) {
    if (req.user?.role !== "landlord" && req.user?.role !== "admin") {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        403,
        "Only landlords can access this resource",
      );
    }
  }

  router.get(
    "/deals/:dealId/insurance/quote",
    authenticateToken,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        assertLandlordOrAdmin(req);
        const { dealId } = req.params;
        const coverageTermMonths =
          parseInt(req.query.coverageTermMonths as string, 10) || 12;

        const quote = await provider.getQuote(dealId, coverageTermMonths);
        auditLog(
          "INSURANCE_QUOTE_REQUESTED" as any,
          extractAuditContext(req, "user"),
          {
            dealId,
            coverageTermMonths,
            quoteId: quote.quoteId,
          },
        );
        res.json({ success: true, data: quote });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/deals/:dealId/insurance/purchase",
    authenticateToken,
    idempotency(),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        assertLandlordOrAdmin(req);
        const { dealId } = req.params;
        const { quoteId } = req.body;

        if (!quoteId) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "quoteId is required",
          );
        }

        const policy = await provider.purchasePolicy(
          dealId,
          req.user!.id,
          quoteId,
        );

        const db = await pool();
        await db.query(
          `INSERT INTO rent_guarantee_policies
         (deal_id, landlord_id, provider, policy_number, premium_ngn, coverage_term_months, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            policy.dealId,
            policy.landlordId,
            policy.provider,
            policy.policyNumber,
            policy.premiumNgn,
            policy.coverageTermMonths,
            policy.status,
          ],
        );

        auditLog(
          "INSURANCE_POLICY_PURCHASED" as any,
          extractAuditContext(req, "user"),
          {
            dealId,
            policyNumber: policy.policyNumber,
            provider: policy.provider,
            premiumNgn: policy.premiumNgn,
          },
        );
        res.status(201).json({ success: true, data: policy });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/insurance/:policyId/claim",
    authenticateToken,
    validate(insuranceClaimBodySchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (req.user?.role !== "landlord" && req.user?.role !== "admin") {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            403,
            "Only landlords can file claims",
          );
        }

        const { policyId } = req.params;
        const claimData = req.body;

        const result = await provider.fileClaim(policyId, claimData);

        const db = await pool();
        await db.query(
          `UPDATE rent_guarantee_policies SET status = 'claimed' WHERE policy_number = $1`,
          [policyId],
        );

        auditLog(
          "INSURANCE_CLAIM_FILED" as any,
          extractAuditContext(req, "user"),
          {
            policyId,
            claimId: result.claimId,
          },
        );
        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
