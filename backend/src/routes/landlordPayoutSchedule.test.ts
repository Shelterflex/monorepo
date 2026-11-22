import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";
import { createLandlordPayoutScheduleRouter } from "./landlordPayoutSchedule.js";
import { landlordPayoutScheduleStore } from "../models/landlordPayoutScheduleStore.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { LandlordPayout } from "../schemas/landlordPayoutSchedule.js";

// Landlord profiles stand in for the user store, which needs PostgreSQL.
const profiles = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("../models/authStore.js", () => ({
  userStore: {
    getLandlordProfile: async (userId: string) => profiles.get(userId) ?? null,
    updateLandlordProfile: async (userId: string, patch: Record<string, unknown>) => {
      profiles.set(userId, { ...(profiles.get(userId) ?? { userId }), ...patch });
    },
  },
}));

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

function payout(landlordId: string, overrides: Partial<LandlordPayout> = {}): LandlordPayout {
  return {
    id: randomUUID(),
    landlordId,
    propertyId: "property-1",
    propertyName: "Lekki Flat",
    scheduledDate: "2026-03-10T09:00:00.000Z",
    completedDate: null,
    grossAmount: 100000,
    deductions: [{ type: "platform_fee", label: "Platform fee", amount: 5000 }],
    netAmount: 95000,
    currency: "NGN",
    status: "scheduled",
    channel: "bank_transfer",
    delayReasons: [],
    periodStart: "2026-03-01T00:00:00.000Z",
    periodEnd: "2026-03-31T23:59:59.999Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/api/landlord/payout-schedule", createLandlordPayoutScheduleRouter());
  app.use(errorHandler);
  return app;
}

const validDestination = {
  bankName: "Guaranty Trust Bank",
  accountNumber: "0123456789",
  accountName: "Ada Landlord",
};

describe("landlord payout schedule (#2055)", () => {
  let app: express.Application;
  // Each test gets its own landlord, because the in-memory store is shared by the module.
  let landlord: string;

  beforeEach(() => {
    app = buildApp();
    landlord = randomUUID();
    profiles.clear();
  });

  describe("access", () => {
    it("requires authentication", async () => {
      await request(app).get("/api/landlord/payout-schedule").expect(401);
      await request(app).get("/api/landlord/payout-schedule/payouts").expect(401);
    });

    it("returns 403 to tenants", async () => {
      await request(app)
        .get("/api/landlord/payout-schedule/payouts")
        .set("x-test-user", landlord)
        .set("x-test-role", "tenant")
        .expect(403);
    });
  });

  describe("schedule", () => {
    it("groups upcoming payouts by property, leaves out completed ones, and summarises", async () => {
      await landlordPayoutScheduleStore.insertIfAbsent(
        payout(landlord, { id: randomUUID(), propertyId: "p-lekki", propertyName: "Lekki Flat" }),
      );
      await landlordPayoutScheduleStore.insertIfAbsent(
        payout(landlord, {
          id: randomUUID(),
          propertyId: "p-yaba",
          propertyName: "Yaba Studio",
          grossAmount: 50000,
          deductions: [],
          netAmount: 50000,
          status: "on_hold",
        }),
      );
      await landlordPayoutScheduleStore.insertIfAbsent(
        payout(landlord, { id: randomUUID(), propertyId: "p-lekki", propertyName: "Lekki Flat", status: "completed" }),
      );

      const res = await request(app)
        .get("/api/landlord/payout-schedule")
        .set("x-test-user", landlord)
        .expect(200);

      expect(res.body.data.grouping).toBe("monthly");
      expect(res.body.data.properties.map((p: { propertyName: string }) => p.propertyName)).toEqual([
        "Lekki Flat",
        "Yaba Studio",
      ]);
      expect(res.body.data.summary).toMatchObject({
        totalPayouts: 2,
        totalGross: 150000,
        totalDeductions: 5000,
        totalNet: 145000,
        onHoldPayouts: 1,
      });
    });

    it("shows a landlord nothing that belongs to another landlord", async () => {
      await landlordPayoutScheduleStore.insertIfAbsent(payout(randomUUID()));

      const res = await request(app)
        .get("/api/landlord/payout-schedule")
        .set("x-test-user", landlord)
        .expect(200);

      expect(res.body.data.properties).toEqual([]);
      expect(res.body.data.summary.totalPayouts).toBe(0);
    });
  });

  describe("history", () => {
    it("pages payouts and computes net as gross minus fees", async () => {
      for (let i = 0; i < 3; i += 1) {
        await landlordPayoutScheduleStore.insertIfAbsent(
          payout(landlord, {
            id: randomUUID(),
            scheduledDate: `2026-03-0${i + 1}T09:00:00.000Z`,
            netAmount: 1, // a wrong stored value that must not leak into the response
          }),
        );
      }

      const res = await request(app)
        .get("/api/landlord/payout-schedule/payouts?page=1&pageSize=2")
        .set("x-test-user", landlord)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      for (const item of res.body.data) {
        expect(item.netAmount).toBe(95000);
      }
    });

    it("returns one payout to its landlord, with net computed", async () => {
      const id = randomUUID();
      await landlordPayoutScheduleStore.insertIfAbsent(payout(landlord, { id }));

      const res = await request(app)
        .get(`/api/landlord/payout-schedule/${id}`)
        .set("x-test-user", landlord)
        .expect(200);

      expect(res.body.data).toMatchObject({ id, grossAmount: 100000, netAmount: 95000 });
    });

    it("returns 404 for another landlord's payout, the same as for a missing one", async () => {
      const id = randomUUID();
      await landlordPayoutScheduleStore.insertIfAbsent(payout(randomUUID(), { id }));

      const foreign = await request(app)
        .get(`/api/landlord/payout-schedule/${id}`)
        .set("x-test-user", landlord)
        .expect(404);
      const missing = await request(app)
        .get(`/api/landlord/payout-schedule/${randomUUID()}`)
        .set("x-test-user", landlord)
        .expect(404);

      expect(foreign.body.error.code).toBe("NOT_FOUND");
      expect(foreign.body.error.message).toBe(missing.body.error.message);
    });
  });

  describe("preference", () => {
    it("returns the default frequency and no destination until one is saved", async () => {
      const res = await request(app)
        .get("/api/landlord/payout-schedule/preference")
        .set("x-test-user", landlord)
        .expect(200);

      expect(res.body.data).toEqual({ schedulePreference: "monthly", destination: null });
    });

    it("updates the frequency", async () => {
      await request(app)
        .put("/api/landlord/payout-schedule/preference")
        .set("x-test-user", landlord)
        .send({ schedulePreference: "weekly" })
        .expect(200);

      const res = await request(app)
        .get("/api/landlord/payout-schedule/preference")
        .set("x-test-user", landlord)
        .expect(200);
      expect(res.body.data.schedulePreference).toBe("weekly");
    });

    it("saves the destination and shows only the last four digits", async () => {
      const res = await request(app)
        .put("/api/landlord/payout-schedule/preference")
        .set("x-test-user", landlord)
        .send({ destination: validDestination })
        .expect(200);

      expect(res.body.data.destination).toEqual({
        bankName: "Guaranty Trust Bank",
        accountName: "Ada Landlord",
        accountNumberLast4: "6789",
      });
      expect(JSON.stringify(res.body)).not.toContain("0123456789");
      expect(profiles.get(landlord)).toMatchObject({
        bankName: "Guaranty Trust Bank",
        accountNumber: "0123456789",
      });
    });

    it("updates the frequency and destination together", async () => {
      const res = await request(app)
        .put("/api/landlord/payout-schedule/preference")
        .set("x-test-user", landlord)
        .send({ schedulePreference: "activation", destination: validDestination })
        .expect(200);

      expect(res.body.data.schedulePreference).toBe("activation");
      expect(res.body.data.destination.accountNumberLast4).toBe("6789");
    });

    it.each([
      ["an account number that is not 10 digits", { destination: { ...validDestination, accountNumber: "012345678" } }],
      ["an account number with letters", { destination: { ...validDestination, accountNumber: "01234abcde" } }],
      ["a missing account name", { destination: { bankName: "GTB", accountNumber: "0123456789" } }],
      ["an unknown frequency", { schedulePreference: "daily" }],
      ["an empty body", {}],
    ])("rejects %s with 400", async (_label, body) => {
      const res = await request(app)
        .put("/api/landlord/payout-schedule/preference")
        .set("x-test-user", landlord)
        .send(body)
        .expect(400);

      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(profiles.get(landlord)).toBeUndefined();
    });
  });
});
