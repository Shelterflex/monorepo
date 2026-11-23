import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTenantSavedPropertiesRouter } from "./tenantSavedProperties.js";
import { listingStore } from "../models/listingStore.js";
import { ListingStatus, type Listing } from "../models/listing.js";
import { errorHandler } from "../middleware/errorHandler.js";

// Authenticates from the x-test-user header; without it, responds 401 like authenticateToken does.
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
    req.user = { id: String(id), email: "tenant@example.test", name: "Tenant", role: "tenant" };
    next();
  },
}));

const listingsById = new Map<string, Listing>();

function seedListing(status: ListingStatus): string {
  const listingId = globalThis.crypto.randomUUID();
  listingsById.set(listingId, {
    listingId,
    whistleblowerId: "wb-test",
    address: "1 Test Road, Lagos",
    bedrooms: 2,
    bathrooms: 1,
    annualRentNgn: 1200000,
    photos: [],
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return listingId;
}

function setStatus(listingId: string, status: ListingStatus): void {
  const listing = listingsById.get(listingId);
  if (listing) listingsById.set(listingId, { ...listing, status });
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/api/tenant/saved-properties", createTenantSavedPropertiesRouter());
  app.use(errorHandler);
  return app;
}

describe("tenant saved properties (#2049)", () => {
  let app: express.Application;
  // Each test uses its own tenant, because the in-memory store is shared by the module.
  let tenant: string;

  beforeEach(() => {
    app = buildApp();
    tenant = globalThis.crypto.randomUUID();
    listingsById.clear();
    vi.spyOn(listingStore, "getById").mockImplementation(
      async (listingId: string) => listingsById.get(listingId) ?? null,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty page for a tenant with nothing saved", async () => {
    const res = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", tenant)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  });

  it("saves an approved listing and lists it", async () => {
    const listingId = seedListing(ListingStatus.APPROVED);

    const saved = await request(app)
      .put(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);
    expect(saved.body).toEqual({ success: true, data: { listingId, saved: true } });

    const list = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", tenant)
      .expect(200);
    expect(list.body.data).toEqual([listingId]);
    expect(list.body.pagination.total).toBe(1);
  });

  it("keeps one entry when the same listing is saved twice, and returns 200 both times", async () => {
    const listingId = seedListing(ListingStatus.APPROVED);

    await request(app)
      .put(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);
    await request(app)
      .put(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);

    const list = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", tenant)
      .expect(200);
    expect(list.body.data).toEqual([listingId]);
    expect(list.body.pagination.total).toBe(1);
  });

  it("returns 404 for a listing id that does not exist", async () => {
    const res = await request(app)
      .put(`/api/tenant/saved-properties/${globalThis.crypto.randomUUID()}`)
      .set("x-test-user", tenant)
      .expect(404);

    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it.each([ListingStatus.PENDING_REVIEW, ListingStatus.REJECTED, ListingStatus.RENTED])(
    "returns 404 when the listing is %s (not publicly visible)",
    async (status) => {
      const listingId = seedListing(status);

      await request(app)
        .put(`/api/tenant/saved-properties/${listingId}`)
        .set("x-test-user", tenant)
        .expect(404);

      const list = await request(app)
        .get("/api/tenant/saved-properties")
        .set("x-test-user", tenant)
        .expect(200);
      expect(list.body.data).toEqual([]);
    },
  );

  it("removes a saved listing, and removing it again still returns 200", async () => {
    const listingId = seedListing(ListingStatus.APPROVED);
    await request(app)
      .put(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);

    const removed = await request(app)
      .delete(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);
    expect(removed.body).toEqual({ success: true, data: { listingId, saved: false } });

    const again = await request(app)
      .delete(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);
    expect(again.body.data.saved).toBe(false);

    const list = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", tenant)
      .expect(200);
    expect(list.body.data).toEqual([]);
  });

  it("can still remove a listing that was rejected after it was saved", async () => {
    const listingId = seedListing(ListingStatus.APPROVED);
    await request(app)
      .put(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);
    setStatus(listingId, ListingStatus.REJECTED);

    await request(app)
      .delete(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);

    const list = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", tenant)
      .expect(200);
    expect(list.body.data).toEqual([]);
  });

  it("only shows each tenant their own saved listings", async () => {
    const listingId = seedListing(ListingStatus.APPROVED);
    const otherTenant = globalThis.crypto.randomUUID();

    await request(app)
      .put(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", tenant)
      .expect(200);

    const otherList = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", otherTenant)
      .expect(200);
    expect(otherList.body.data).toEqual([]);

    // Removing someone else's save does nothing to the owner's list.
    await request(app)
      .delete(`/api/tenant/saved-properties/${listingId}`)
      .set("x-test-user", otherTenant)
      .expect(200);
    const ownerList = await request(app)
      .get("/api/tenant/saved-properties")
      .set("x-test-user", tenant)
      .expect(200);
    expect(ownerList.body.data).toEqual([listingId]);
  });

  it("pages the saved list", async () => {
    const ids = [seedListing(ListingStatus.APPROVED), seedListing(ListingStatus.APPROVED), seedListing(ListingStatus.APPROVED)];
    for (const id of ids) {
      await request(app)
        .put(`/api/tenant/saved-properties/${id}`)
        .set("x-test-user", tenant)
        .expect(200);
    }

    const page2 = await request(app)
      .get("/api/tenant/saved-properties?page=2&pageSize=2")
      .set("x-test-user", tenant)
      .expect(200);

    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it("rejects a listing id that is not a UUID with 400", async () => {
    await request(app)
      .put("/api/tenant/saved-properties/not-a-uuid")
      .set("x-test-user", tenant)
      .expect(400);
  });

  it("requires authentication on every route", async () => {
    const listingId = seedListing(ListingStatus.APPROVED);

    await request(app).get("/api/tenant/saved-properties").expect(401);
    await request(app).put(`/api/tenant/saved-properties/${listingId}`).expect(401);
    await request(app).delete(`/api/tenant/saved-properties/${listingId}`).expect(401);
  });
});
