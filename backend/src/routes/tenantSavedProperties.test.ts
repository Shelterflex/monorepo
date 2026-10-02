import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createTenantSavedPropertiesRouter } from "./tenantSavedProperties.js";
import {
  InMemorySavedPropertyStore,
  initSavedPropertyStore,
} from "../models/savedPropertyStore.js";
import { errorHandler } from "../middleware/errorHandler.js";

vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { userId: string } }).user = {
      userId: "tenant-user-1",
    };
    next();
  },
}));

describe("Tenant Saved Properties Routes", () => {
  let app: express.Application;
  let store: InMemorySavedPropertyStore;

  beforeEach(async () => {
    store = new InMemorySavedPropertyStore();
    initSavedPropertyStore(store);

    app = express();
    app.use(express.json());
    app.use("/api/tenant/saved-properties", createTenantSavedPropertiesRouter());
    app.use(errorHandler);

    await store.clear();
  });

  it("returns empty list and default pagination when nothing is saved", async () => {
    const response = await request(app)
      .get("/api/tenant/saved-properties")
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
  });

  it("saves and lists a property", async () => {
    await request(app)
      .post("/api/tenant/saved-properties/listing-abc")
      .expect(201);

    const response = await request(app)
      .get("/api/tenant/saved-properties")
      .expect(200);

    expect(response.body.data).toEqual(["listing-abc"]);
    expect(response.body.pagination).toEqual({
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
  });

  it("removes a saved property", async () => {
    await request(app).post("/api/tenant/saved-properties/listing-abc").expect(201);

    await request(app)
      .delete("/api/tenant/saved-properties/listing-abc")
      .expect(200);

    const response = await request(app)
      .get("/api/tenant/saved-properties")
      .expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  describe("Pagination", () => {
    beforeEach(async () => {
      // Save 5 properties: listing-1 through listing-5
      for (let i = 1; i <= 5; i++) {
        await store.save("tenant-user-1", `listing-${i}`);
      }
    });

    it("respects limit and offset query parameters", async () => {
      const response = await request(app)
        .get("/api/tenant/saved-properties?limit=2&offset=0")
        .expect(200);

      expect(response.body.data).toEqual(["listing-1", "listing-2"]);
      expect(response.body.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 0,
        hasMore: true,
      });

      const nextResponse = await request(app)
        .get("/api/tenant/saved-properties?limit=2&offset=2")
        .expect(200);

      expect(nextResponse.body.data).toEqual(["listing-3", "listing-4"]);
      expect(nextResponse.body.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 2,
        hasMore: true,
      });

      const finalResponse = await request(app)
        .get("/api/tenant/saved-properties?limit=2&offset=4")
        .expect(200);

      expect(finalResponse.body.data).toEqual(["listing-5"]);
      expect(finalResponse.body.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 4,
        hasMore: false,
      });
    });

    it("supports page and pageSize query parameters", async () => {
      const response = await request(app)
        .get("/api/tenant/saved-properties?page=2&pageSize=2")
        .expect(200);

      expect(response.body.data).toEqual(["listing-3", "listing-4"]);
      expect(response.body.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 2,
        hasMore: true,
      });
    });

    it("clamps limit between 1 and 100", async () => {
      const maxClamped = await request(app)
        .get("/api/tenant/saved-properties?limit=500")
        .expect(200);

      expect(maxClamped.body.pagination.limit).toBe(100);

      const minClamped = await request(app)
        .get("/api/tenant/saved-properties?limit=0")
        .expect(200);

      expect(minClamped.body.pagination.limit).toBe(1);
    });

    it("falls back to default limit on invalid query input", async () => {
      const response = await request(app)
        .get("/api/tenant/saved-properties?limit=invalid&offset=invalid")
        .expect(200);

      expect(response.body.pagination.limit).toBe(50);
      expect(response.body.pagination.offset).toBe(0);
      expect(response.body.data).toHaveLength(5);
    });

    it("returns empty data when offset exceeds total records", async () => {
      const response = await request(app)
        .get("/api/tenant/saved-properties?offset=10")
        .expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.pagination).toEqual({
        total: 5,
        limit: 50,
        offset: 10,
        hasMore: false,
      });
    });
  });
});
