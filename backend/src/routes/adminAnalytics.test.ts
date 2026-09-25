import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  },
}));

import { createAdminAnalyticsRouter } from "./adminAnalytics.js";

describe("Admin Analytics Router - Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildApp(role: string) {
    const app = express();
    app.use(express.json());
    app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as any).user = {
        id: "admin-user-123",
        role,
      };
      next();
    });
    app.use("/api/admin/analytics", createAdminAnalyticsRouter());
    return app;
  }

  describe("GET /api/admin/analytics/overview", () => {
    it("returns MTD KPIs for an authorized admin", async () => {
      const res = await request(buildApp("admin")).get("/api/admin/analytics/overview");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.usersByRole).toBeDefined();
      expect(res.body.data.activeDeals).toBeDefined();
      expect(res.body.data.revenueMtd).toBeDefined();
      expect(res.body.data.defaultRate).toBeDefined();
    });

    it("rejects non-admin roles with 403", async () => {
      const res = await request(buildApp("tenant")).get("/api/admin/analytics/overview");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/admin/analytics/deal-funnel", () => {
    it("returns status group counts for an authorized admin", async () => {
      const res = await request(buildApp("super_admin")).get("/api/admin/analytics/deal-funnel");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.draft).toBeDefined();
      expect(res.body.data.active).toBeDefined();
      expect(res.body.data.completed).toBeDefined();
    });

    it("rejects non-admin roles with 403", async () => {
      const res = await request(buildApp("agent")).get("/api/admin/analytics/deal-funnel");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/admin/analytics/revenue", () => {
    it("returns chronological time-series revenue metrics", async () => {
      const res = await request(buildApp("admin"))
        .get("/api/admin/analytics/revenue")
        .query({ range: "30d" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.series).toBeDefined();
      expect(Array.isArray(res.body.data.series)).toBe(true);
      expect(res.body.data.dataSource).toBeDefined();
      expect(["live", "mock"]).toContain(res.body.data.dataSource);
      if (res.body.data.series.length > 0) {
        expect(res.body.data.series[0].date).toBeDefined();
        expect(res.body.data.series[0].feeType).toBeDefined();
        expect(res.body.data.series[0].amount).toBeDefined();
      }
    });

    it("handles different ranges like 7d or 90d", async () => {
      const res = await request(buildApp("admin"))
        .get("/api/admin/analytics/revenue")
        .query({ range: "7d" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.series).toBeDefined();
      expect(res.body.data.dataSource).toBeDefined();
    });

    it("rejects non-admin roles with 403", async () => {
      const res = await request(buildApp("tenant")).get("/api/admin/analytics/revenue");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/admin/analytics/listing-quality", () => {
    it("returns pass rates, complaint averages, and listing scores", async () => {
      const res = await request(buildApp("admin")).get("/api/admin/analytics/listing-quality");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.inspectionPassRate).toBeDefined();
      expect(res.body.data.averageListingScore).toBeDefined();
      expect(res.body.data.whistleblowerReportRate).toBeDefined();
    });

    it("rejects non-admin roles with 403", async () => {
      const res = await request(buildApp("tenant")).get("/api/admin/analytics/listing-quality");
      expect(res.status).toBe(403);
    });
  });
});
