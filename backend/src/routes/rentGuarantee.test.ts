import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { sessionStore, userStore } from "../models/authStore.js";
import { expectErrorShape } from "../test-helpers.js";
import type {
  RentGuaranteeProvider,
  InsuranceQuote,
  InsurancePolicy,
  ClaimResult,
} from "../services/insurance/RentGuaranteeProvider.js";

// Mock RentGuaranteeProvider
class MockRentGuaranteeProvider implements RentGuaranteeProvider {
  async getQuote(
    dealId: string,
    coverageTermMonths: number,
  ): Promise<InsuranceQuote> {
    return {
      premiumAmountNgn: 50000,
      coverageTermMonths,
      coverageDetails: { dealId },
      quoteId: `quote-${dealId}`,
    };
  }

  async purchasePolicy(
    dealId: string,
    landlordId: string,
    quoteId: string,
  ): Promise<InsurancePolicy> {
    return {
      policyNumber: `policy-${dealId}`,
      dealId,
      landlordId,
      provider: "mock-provider",
      premiumNgn: 50000,
      coverageTermMonths: 12,
      status: "active",
      createdAt: new Date(),
    };
  }

  async cancelPolicy(policyId: string, reason: string): Promise<void> {
    // Mock implementation
  }

  async fileClaim(
    policyId: string,
    claimData: Record<string, unknown>,
  ): Promise<ClaimResult> {
    return {
      claimId: `claim-${policyId}`,
      policyNumber: policyId,
      status: "submitted",
      details: claimData,
    };
  }
}

describe("Rent Guarantee API", () => {
  let app: any;
  let landlordToken: string;
  let tenantToken: string;
  let adminToken: string;
  let landlordId: string;
  let tenantId: string;
  let adminId: string;
  let mockProvider: RentGuaranteeProvider;

  beforeEach(async () => {
    sessionStore.clear();
    userStore.clear();
    mockProvider = new MockRentGuaranteeProvider();

    // Create a landlord user
    const landlord = await userStore.getOrCreateByEmail("landlord@example.com");
    landlordId = landlord.id;
    const landlordSession = await sessionStore.create(
      "landlord@example.com",
      "landlord-session-token",
    );
    landlordToken = landlordSession.token;

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

    // Create app with mock provider
    app = createApp();
  });

  describe("GET /api/v1/deals/:dealId/insurance/quote", () => {
    it("should reject unauthenticated request", async () => {
      const dealId = "deal-123";
      const response = await request(app)
        .get(`/api/v1/deals/${dealId}/insurance/quote`)
        .expect(401);

      expectErrorShape(response, "UNAUTHORIZED", 401);
    });

    it("should reject non-landlord user", async () => {
      const dealId = "deal-123";
      const response = await request(app)
        .get(`/api/v1/deals/${dealId}/insurance/quote`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(403);

      expectErrorShape(response, "FORBIDDEN", 403);
      expect(response.body.error.message).toContain("Only landlords");
    });
  });

  describe("POST /api/v1/deals/:dealId/insurance/purchase", () => {
    it("should reject unauthenticated request", async () => {
      const dealId = "deal-123";
      const response = await request(app)
        .post(`/api/v1/deals/${dealId}/insurance/purchase`)
        .send({ quoteId: "quote-123" })
        .expect(401);

      expectErrorShape(response, "UNAUTHORIZED", 401);
    });

    it("should reject non-landlord user", async () => {
      const dealId = "deal-123";
      const response = await request(app)
        .post(`/api/v1/deals/${dealId}/insurance/purchase`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ quoteId: "quote-123" })
        .expect(403);

      expectErrorShape(response, "FORBIDDEN", 403);
    });
  });

  describe("POST /api/v1/insurance/:policyId/claim", () => {
    it("should reject unauthenticated request", async () => {
      const policyId = "policy-123";
      const response = await request(app)
        .post(`/api/v1/insurance/${policyId}/claim`)
        .send({ reason: "non-payment", claimAmount: 500000 })
        .expect(401);

      expectErrorShape(response, "UNAUTHORIZED", 401);
    });

    it("should reject non-landlord user", async () => {
      const policyId = "policy-123";
      const response = await request(app)
        .post(`/api/v1/insurance/${policyId}/claim`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ reason: "non-payment", claimAmount: 500000 })
        .expect(403);

      expectErrorShape(response, "FORBIDDEN", 403);
      expect(response.body.error.message).toContain("Only landlords");
    });
  });
});
