import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { sessionStore, userStore } from "../models/authStore.js";
import { expectErrorShape } from "../test-helpers.js";

describe("Referrals API", () => {
  let app: any;
  let tenantToken: string;
  let adminToken: string;
  let tenantId: string;
  let adminId: string;

  beforeEach(async () => {
    sessionStore.clear();
    userStore.clear();
    app = createApp();

    // Create a tenant user
    const tenant = await userStore.getOrCreateByEmail("tenant@example.com");
    tenantId = tenant.id;
    const tenantSession = await sessionStore.create(
      "tenant@example.com",
      "tenant-session-token",
    );
    tenantToken = tenantSession.token;

    // Create an admin user
    const admin = await userStore.getOrCreateByEmail("admin@example.com");
    adminId = admin.id;
    const adminSession = await sessionStore.create(
      "admin@example.com",
      "admin-session-token",
    );
    adminToken = adminSession.token;
  });

  describe("POST /api/v1/referrals/apply", () => {
    it("should return 400 when referralCode is missing", async () => {
      const response = await request(app).post("/api/v1/referrals/apply").send({
        referredTenantId: tenantId,
      });

      expect(response.status).toBe(400);
      expectErrorShape(response, "VALIDATION_ERROR", 400);
    });

    it("should return 400 when referred tenant id is missing", async () => {
      const response = await request(app).post("/api/v1/referrals/apply").send({
        referralCode: "ABCD1234",
      });

      expect(response.status).toBe(400);
      expectErrorShape(response, "VALIDATION_ERROR", 400);
    });
  });

  describe("GET /api/v1/referrals/admin/referrals", () => {
    it("should return 401 when unauthenticated", async () => {
      const response = await request(app).get(
        "/api/v1/referrals/admin/referrals",
      );

      expect(response.status).toBe(401);
      expectErrorShape(response, "UNAUTHORIZED", 401);
    });

    it("should return 403 when non-admin tries to access", async () => {
      const response = await request(app)
        .get("/api/v1/referrals/admin/referrals")
        .set("Authorization", `Bearer ${tenantToken}`);

      expect(response.status).toBe(403);
      expectErrorShape(response, "FORBIDDEN", 403);
    });
  });
});
