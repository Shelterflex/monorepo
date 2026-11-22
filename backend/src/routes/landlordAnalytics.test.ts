import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";
import { createLandlordAnalyticsRouter } from "./landlordAnalytics.js";
import { landlordPropertyStore } from "../models/landlordPropertyStore.js";
import { listingStore } from "../models/listingStore.js";
import { dealStore } from "../models/dealStore.js";
import { DealStatus, ScheduleItemStatus } from "../models/deal.js";
import type { LandlordProperty } from "../models/landlordProperty.js";
import { errorHandler } from "../middleware/errorHandler.js";

// Authenticates from x-test-user, with the role from x-test-role (default landlord).
vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    const id = req.headers["x-test-user"];
    if (!id) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
      return;
    }
    req.user = {
      id: String(id),
      email: "landlord@example.test",
      name: "Landlord",
      role: req.headers["x-test-role"] ?? "landlord",
    };
    next();
  },
}));

// The property, listing and deal stores are replaced with in-test data, so the route is tested without a database.
const properties: LandlordProperty[] = [];
const listings = new Map<string, { listingId: string; dealId?: string }>();
const deals = new Map<string, Record<string, unknown>>();

function addProperty(landlordId: string, overrides: Partial<LandlordProperty> = {}): LandlordProperty {
  const property = {
    id: randomUUID(),
    landlordId,
    title: "Lekki Flat",
    address: "1 Test Road",
    bedrooms: 2,
    bathrooms: 1,
    annualRentNgn: 1200000,
    amenities: [],
    photos: [],
    primaryPhotoIndex: 0,
    status: "approved",
    views: 0,
    inquiries: 0,
    createdAt: new Date("2025-12-01T00:00:00.000Z"),
    updatedAt: new Date("2025-12-01T00:00:00.000Z"),
    ...overrides,
  } as unknown as LandlordProperty;
  properties.push(property);
  return property;
}

/** Links a property to an active deal that started on `createdAt`, with a two-instalment schedule. */
function letProperty(property: LandlordProperty, createdAt: string): void {
  const listingId = randomUUID();
  const dealId = randomUUID();
  listings.set(listingId, { listingId, dealId });
  deals.set(dealId, {
    dealId,
    tenantId: "tenant-1",
    landlordId: property.landlordId,
    listingId,
    createdAt: new Date(createdAt),
    status: DealStatus.ACTIVE,
    schedule: [
      { period: 1, dueDate: "2026-02-05T00:00:00.000Z", amountNgn: 50000, status: ScheduleItemStatus.PAID },
      { period: 2, dueDate: "2026-03-05T00:00:00.000Z", amountNgn: 50000, status: ScheduleItemStatus.UPCOMING },
    ],
  });
  (property as unknown as { listingId?: string }).listingId = listingId;
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/api/landlord/analytics", createLandlordAnalyticsRouter());
  app.use(errorHandler);
  return app;
}

describe("landlord analytics (#2054)", () => {
  let app: express.Application;
  let landlord: string;

  beforeEach(() => {
    // Pin "now" so overdue instalments are deterministic. Only Date is faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));

    app = buildApp();
    landlord = randomUUID();
    properties.length = 0;
    listings.clear();
    deals.clear();

    vi.spyOn(landlordPropertyStore, "list").mockImplementation(async (filters: any) => {
      const mine = properties.filter((p) => p.landlordId === filters.landlordId);
      const pageSize = filters.pageSize ?? 20;
      return {
        properties: mine,
        total: mine.length,
        page: filters.page ?? 1,
        pageSize,
        totalPages: Math.max(1, Math.ceil(mine.length / pageSize)),
      } as any;
    });
    vi.spyOn(listingStore, "getById").mockImplementation(
      async (listingId: string) => (listings.get(listingId) ?? null) as any,
    );
    vi.spyOn(dealStore, "findById").mockImplementation(
      async (dealId: string) => (deals.get(dealId) ?? null) as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requires authentication", async () => {
    await request(app).get("/api/landlord/analytics").expect(401);
  });

  it("returns 403 to tenants", async () => {
    await request(app)
      .get("/api/landlord/analytics")
      .set("x-test-user", landlord)
      .set("x-test-role", "tenant")
      .expect(403);
  });

  it("returns zeroed arrays for a landlord with no properties", async () => {
    const res = await request(app)
      .get("/api/landlord/analytics?startDate=2026-01-01&endDate=2026-03-31")
      .set("x-test-user", landlord)
      .expect(200);

    expect(res.body).toEqual({
      occupancyTrend: [
        { date: "2026-01", rate: 0 },
        { date: "2026-02", rate: 0 },
        { date: "2026-03", rate: 0 },
      ],
      revenueBreakdown: [
        { month: "2026-01", expected: 0, collected: 0 },
        { month: "2026-02", expected: 0, collected: 0 },
        { month: "2026-03", expected: 0, collected: 0 },
      ],
      paymentTrends: [],
      vacancyMetrics: { averageTimeToFill: 0, currentVacancyCount: 0 },
    });
  });

  it("reports occupancy, revenue, payments and vacancy for a let property", async () => {
    const property = addProperty(landlord);
    letProperty(property, "2026-02-10T00:00:00.000Z");

    const res = await request(app)
      .get("/api/landlord/analytics?startDate=2026-01-01&endDate=2026-03-31")
      .set("x-test-user", landlord)
      .expect(200);

    // Occupied from the deal start, so January is empty and February and March are full.
    expect(res.body.occupancyTrend.map((p: { rate: number }) => p.rate)).toEqual([0, 100, 100]);

    // The paid instalment has no timestamp, so it counts in its due month. Instalment two is expected in March.
    expect(res.body.revenueBreakdown).toEqual([
      { month: "2026-01", expected: 0, collected: 0 },
      { month: "2026-02", expected: 50000, collected: 50000 },
      { month: "2026-03", expected: 50000, collected: 0 },
    ]);

    // Paid instalments with no timestamp are left out of the trends. Instalment two is past due on 20 March and unpaid, so it counts as missed.
    expect(res.body.paymentTrends).toEqual([{ date: "2026-03-05", onTime: 0, late: 0, missed: 1 }]);

    // Dec 1 to Feb 10 is 71 days. The property is occupied now, so it is not a current vacancy.
    expect(res.body.vacancyMetrics).toEqual({ averageTimeToFill: 71, currentVacancyCount: 0 });
  });

  it("returns 404 for a propertyId that belongs to another landlord", async () => {
    const mine = addProperty(landlord);
    const theirs = addProperty(randomUUID());

    await request(app)
      .get(`/api/landlord/analytics?propertyId=${theirs.id}`)
      .set("x-test-user", landlord)
      .expect(404);

    // The landlord's own property still works.
    await request(app)
      .get(`/api/landlord/analytics?propertyId=${mine.id}`)
      .set("x-test-user", landlord)
      .expect(200);
  });

  it("never includes another landlord's properties in the totals", async () => {
    addProperty(landlord);
    const other = addProperty(randomUUID());
    letProperty(other, "2026-01-01T00:00:00.000Z");

    const res = await request(app)
      .get("/api/landlord/analytics?startDate=2026-01-01&endDate=2026-03-31")
      .set("x-test-user", landlord)
      .expect(200);

    expect(res.body.occupancyTrend.map((p: { rate: number }) => p.rate)).toEqual([0, 0, 0]);
    expect(res.body.vacancyMetrics.currentVacancyCount).toBe(1);
  });

  it("uses the last 12 calendar months when no dates are given", async () => {
    const res = await request(app)
      .get("/api/landlord/analytics")
      .set("x-test-user", landlord)
      .expect(200);

    expect(res.body.occupancyTrend).toHaveLength(12);
    expect(res.body.occupancyTrend[0].date).toBe("2025-04");
    expect(res.body.occupancyTrend[11].date).toBe("2026-03");
  });

  it("rejects an inverted range with 400", async () => {
    await request(app)
      .get("/api/landlord/analytics?startDate=2026-03-01&endDate=2026-01-01")
      .set("x-test-user", landlord)
      .expect(400);
  });

  it("allows 24 months and rejects 25", async () => {
    await request(app)
      .get("/api/landlord/analytics?startDate=2024-01-01&endDate=2025-12-31")
      .set("x-test-user", landlord)
      .expect(200);

    const res = await request(app)
      .get("/api/landlord/analytics?startDate=2024-01-01&endDate=2026-01-31")
      .set("x-test-user", landlord)
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a date that is not a real calendar day", async () => {
    await request(app)
      .get("/api/landlord/analytics?startDate=2026-02-30&endDate=2026-03-31")
      .set("x-test-user", landlord)
      .expect(400);
  });
});
