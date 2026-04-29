import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createPartnerLandlordApplicationsRouter } from "./partnerLandlordApplications.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { requestIdMiddleware } from "../middleware/requestId.js";
import {
  InMemoryPartnerLandlordApplicationStore,
  initPartnerLandlordApplicationStore,
} from "../models/partnerLandlordApplicationStore.js";
import { expectRequestId } from "../test-helpers.js";

describe("Partner Landlord Application Routes", () => {
  let app: express.Application;
  let store: InMemoryPartnerLandlordApplicationStore;

  beforeEach(async () => {
    store = new InMemoryPartnerLandlordApplicationStore();
    initPartnerLandlordApplicationStore(store);

    app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/landlord/partner-applications",
      createPartnerLandlordApplicationsRouter(),
    );
    app.use(errorHandler);

    await store.clear();
  });

  it("creates partner landlord application with valid payload", async () => {
    const response = await request(app)
      .post("/api/landlord/partner-applications")
      .send({
        fullName: "Adeola Adebayo",
        phoneNumber: "08012345678",
        email: "adeola@example.com",
        propertyCount: 5,
        propertyLocations: "Lekki, Yaba",
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationId).toBeDefined();
    expect(response.body.data.status).toBe("pending");
  });

  it("rejects invalid partner landlord payload with validation error", async () => {
    const response = await request(app)
      .post("/api/landlord/partner-applications")
      .send({
        fullName: "",
        phoneNumber: "123",
        email: "not-an-email",
        propertyCount: 0,
        propertyLocations: "",
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("Invalid request data");
    expect(response.body.error.details).toBeTruthy();
    expect(response.body.error.classification).toBe("permanent");
    expect(response.body.error.retryable).toBe(false);
    expectRequestId(response);
  });
});
