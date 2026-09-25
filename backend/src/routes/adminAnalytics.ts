import { Router, type Request, type Response, type NextFunction } from "express";
import { authenticateToken, type AuthenticatedRequest } from "../middleware/auth.js";
import { getPool } from "../db.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { MemoryCacheLayer } from "../utils/cache.js";
import { dealStore } from "../models/dealStore.js";
import { listingStore } from "../models/listingStore.js";
import { userStore } from "../models/authStore.js";

export type DataSource = "live" | "mock";

// Cache for analytics endpoints (60 seconds TTL)
const analyticsCache = new MemoryCacheLayer<any>({
  max: 100,
  ttlMs: 60000,
});

/**
 * Admin role verification helper
 */
function requireAdmin(req: Request): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication required");
  }
  const role = user.role as string;
  if (role !== "admin" && role !== "super_admin") {
    throw new AppError(ErrorCode.FORBIDDEN, 403, "Admin access required");
  }
}

export function createAdminAnalyticsRouter(): Router {
  const router = Router();

  /**
   * Helper to check if DB is configured and available
   */
  async function isDbAvailable(): Promise<boolean> {
    try {
      const pool = await getPool();
      return pool !== null;
    } catch {
      return false;
    }
  }

  /**
   * GET /api/admin/analytics/overview
   * Returns KPIs: user breakdown, active deals count, MTD platform revenue, and default rate.
   */
  router.get(
    "/overview",
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req);

        const cacheKey = "overview";
        const cached = await analyticsCache.get(cacheKey);
        if (cached) {
          return res.json(cached);
        }

        const dbActive = await isDbAvailable();
        let payload;

        if (dbActive) {
          const pool = await getPool();
          
          // 1. Total users by role
          const { rows: userRows } = await pool!.query(
            "SELECT role, COUNT(*) as count FROM users WHERE deleted_at IS NULL GROUP BY role"
          );
          const usersByRole = {
            tenant: 0,
            landlord: 0,
            agent: 0,
            admin: 0,
          };
          userRows.forEach((row: { role: string; count: string }) => {
            const role = row.role as keyof typeof usersByRole;
            if (role in usersByRole) {
              usersByRole[role] = Number(row.count);
            }
          });

          // 2. Active deals count (active + at_risk)
          const { rows: dealRows } = await pool!.query(
            "SELECT COUNT(*) as count FROM tenant_deals WHERE status IN ('active', 'at_risk') AND deleted_at IS NULL"
          );
          const activeDeals = Number(dealRows[0]?.count || 0);

          // 3. Platform Revenue Month-To-Date (MTD)
          const { rows: revRows } = await pool!.query(
            `SELECT COALESCE(SUM(amount_ngn), 0) as total 
             FROM settlement_ledger_entries 
             WHERE beneficiary_type = 'platform' 
               AND created_at >= date_trunc('month', NOW())`
          );
          const revenueMtd = Number(revRows[0]?.total || 0);

          // 4. Default rate
          const { rows: defRows } = await pool!.query(
            `SELECT 
               COUNT(*) FILTER (WHERE status = 'defaulted') as defaulted,
               COUNT(*) as total
             FROM tenant_deals WHERE deleted_at IS NULL`
          );
          const defaulted = Number(defRows[0]?.defaulted || 0);
          const totalDeals = Number(defRows[0]?.total || 0);
          const defaultRate = totalDeals > 0 ? (defaulted / totalDeals) * 100 : 0.0;

          payload = {
            success: true,
            data: {
              usersByRole,
              activeDeals,
              revenueMtd,
              defaultRate: parseFloat(defaultRate.toFixed(2)),
              period: "MTD",
              dataSource: "live" as DataSource,
            },
          };
        } else {
          // In-Memory/Fallback stats for local testing
          const allDeals = await dealStore.findMany({ pageSize: 1000 });
          const activeCount = allDeals.deals.filter(
            (d) => d.status === "active" || d.status === "at_risk"
          ).length;
          const defaultedCount = allDeals.deals.filter((d) => d.status === "defaulted").length;
          const totalCount = allDeals.deals.length;
          const defaultRate = totalCount > 0 ? (defaultedCount / totalCount) * 100 : 2.5; // default fallback rate

          payload = {
            success: true,
            data: {
              usersByRole: {
                tenant: 1420,
                landlord: 320,
                agent: 45,
                admin: 5,
              },
              activeDeals: activeCount || 42,
              revenueMtd: 3850000, // mock MTD revenue (3.85M NGN)
              defaultRate: parseFloat(defaultRate.toFixed(2)),
              period: "MTD",
              dataSource: "mock" as DataSource,
            },
          };
        }

        await analyticsCache.set(cacheKey, payload);
        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/analytics/deal-funnel
   * Returns counts per deal status for funnel visualizer.
   */
  router.get(
    "/deal-funnel",
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req);

        const cacheKey = "deal-funnel";
        const cached = await analyticsCache.get(cacheKey);
        if (cached) {
          return res.json(cached);
        }

        const dbActive = await isDbAvailable();
        let payload;

        if (dbActive) {
          const pool = await getPool();
          const { rows } = await pool!.query(
            "SELECT status, COUNT(*) as count FROM tenant_deals WHERE deleted_at IS NULL GROUP BY status"
          );

          const funnel: Record<string, number> = {
            draft: 0,
            active: 0,
            at_risk: 0,
            completed: 0,
            defaulted: 0,
          };

          rows.forEach((row: { status: string; count: string }) => {
            if (row.status in funnel) {
              funnel[row.status] = Number(row.count);
            }
          });

          payload = {
            success: true,
            data: {
              ...funnel,
              dataSource: "live" as DataSource,
            },
          };
        } else {
          // Fallback mock counts
          const allDeals = await dealStore.findMany({ pageSize: 1000 });
          const funnel: Record<string, number> = {
            draft: 0,
            active: 0,
            at_risk: 0,
            completed: 0,
            defaulted: 0,
          };

          allDeals.deals.forEach((d) => {
            if (d.status in funnel) {
              funnel[d.status]++;
            }
          });

          // Seed default mock numbers if database is empty
          if (Object.values(funnel).reduce((a, b) => a + b, 0) === 0) {
            funnel.draft = 15;
            funnel.active = 42;
            funnel.at_risk = 3;
            funnel.completed = 28;
            funnel.defaulted = 1;
          }

          payload = {
            success: true,
            data: {
              ...funnel,
              dataSource: "mock" as DataSource,
            },
          };
        }

        await analyticsCache.set(cacheKey, payload);
        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/analytics/revenue
   * Returns daily/weekly/monthly revenue details grouped by range.
   */
  router.get(
    "/revenue",
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req);

        const range = (req.query.range as string) || "30d";
        const cacheKey = `revenue:${range}`;
        const cached = await analyticsCache.get(cacheKey);
        if (cached) {
          return res.json(cached);
        }

        let interval = "30 days";
        if (range === "7d") interval = "7 days";
        if (range === "90d") interval = "90 days";

        const dbActive = await isDbAvailable();
        let payload;

        if (dbActive) {
          const pool = await getPool();
          const { rows } = await pool!.query(
            `SELECT 
               DATE(created_at) as date,
               event_type as fee_type,
               COALESCE(SUM(amount_ngn), 0) as amount
             FROM settlement_ledger_entries
             WHERE beneficiary_type = 'platform'
               AND created_at >= NOW() - $1::interval
             GROUP BY DATE(created_at), event_type
             ORDER BY date ASC`,
            [interval]
          );

          const formattedData = rows.map((row: any) => ({
            date: new Date(row.date).toISOString().split("T")[0],
            feeType: row.fee_type || "platform_fee",
            amount: Number(row.amount),
          }));

          payload = {
            success: true,
            data: {
              series: formattedData,
              dataSource: "live" as DataSource,
            },
          };
        } else {
          // Fallback mock time-series data
          const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
          const mockData = [];
          const now = new Date();

          for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateString = date.toISOString().split("T")[0];

            // Platform fee mock
            mockData.push({
              date: dateString,
              feeType: "platform_fee",
              amount: Math.floor(50000 + Math.random() * 80000),
            });

            // Listing premium option mock
            mockData.push({
              date: dateString,
              feeType: "underwriting_fee",
              amount: Math.floor(10000 + Math.random() * 30000),
            });
          }

          payload = {
            success: true,
            data: {
              series: mockData,
              dataSource: "mock" as DataSource,
            },
          };
        }

        await analyticsCache.set(cacheKey, payload);
        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/analytics/listing-quality
   * Returns inspection pass rate, whistleblower issue rate, and average listing score.
   */
  router.get(
    "/listing-quality",
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req);

        const cacheKey = "listing-quality";
        const cached = await analyticsCache.get(cacheKey);
        if (cached) {
          return res.json(cached);
        }

        const dbActive = await isDbAvailable();
        let payload;

        if (dbActive) {
          const pool = await getPool();

          // 1. Inspection pass rate
          const { rows: inspRows } = await pool!.query(
            `SELECT 
               COUNT(*) FILTER (WHERE status = 'approved') as approved,
               COUNT(*) as total
             FROM inspection_jobs`
          );
          const approved = Number(inspRows[0]?.approved || 0);
          const totalInsp = Number(inspRows[0]?.total || 0);
          const inspectionPassRate = totalInsp > 0 ? (approved / totalInsp) * 100 : 0.0;

          // 2. Average listing quality score
          const { rows: scoreRows } = await pool!.query(
            `SELECT COALESCE(AVG(CASE 
               WHEN overall_grade = 'A+' THEN 100
               WHEN overall_grade = 'A' THEN 95
               WHEN overall_grade = 'A-' THEN 90
               WHEN overall_grade = 'B+' THEN 85
               WHEN overall_grade = 'B' THEN 80
               WHEN overall_grade = 'B-' THEN 75
               WHEN overall_grade = 'C+' THEN 70
               WHEN overall_grade = 'C' THEN 65
               ELSE 50
             END), 0) as avg_score FROM inspection_reports`
          );
          const averageListingScore = parseFloat(Number(scoreRows[0]?.avg_score || 0).toFixed(1));

          // 3. Whistleblower issue report rate
          const { rows: listRows } = await pool!.query(
            "SELECT COUNT(*) as count FROM whistleblower_listings WHERE deleted_at IS NULL"
          );
          const { rows: issueRows } = await pool!.query(
            "SELECT COUNT(*) as count FROM property_issue_reports"
          );
          const totalListings = Number(listRows[0]?.count || 0);
          const totalIssues = Number(issueRows[0]?.count || 0);
          const whistleblowerReportRate =
            totalListings > 0 ? (totalIssues / totalListings) * 100 : 0.0;

          payload = {
            success: true,
            data: {
              inspectionPassRate: parseFloat(inspectionPassRate.toFixed(2)),
              averageListingScore: averageListingScore || 85.0,
              whistleblowerReportRate: parseFloat(whistleblowerReportRate.toFixed(2)),
              dataSource: "live" as DataSource,
            },
          };
        } else {
          // Fallback mock stats
          payload = {
            success: true,
            data: {
              inspectionPassRate: 92.5,
              averageListingScore: 88.4,
              whistleblowerReportRate: 4.2, // 4.2% of listings have issues reported
              dataSource: "mock" as DataSource,
            },
          };
        }

        await analyticsCache.set(cacheKey, payload);
        res.json(payload);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
