import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requestIdMiddleware } from "./requestId.js";

function buildApp() {
  const app = express();
  app.use(requestIdMiddleware);

  app.get("/ping", (req, res) => {
    res.status(200).json({ requestId: req.requestId });
  });

  return app;
}

describe("requestIdMiddleware", () => {
  it("generates x-request-id when absent and attaches it to req", async () => {
    const app = buildApp();

    const res = await request(app).get("/ping").expect(200);

    const headerRequestId = res.headers["x-request-id"];
    expect(typeof headerRequestId).toBe("string");
    expect(headerRequestId.length).toBeGreaterThan(0);
    expect(res.body.requestId).toBe(headerRequestId);
  });

  it("propagates incoming x-request-id and preserves it on req", async () => {
    const app = buildApp();
    const incomingRequestId = "trace-abc-123";

    const res = await request(app)
      .get("/ping")
      .set("x-request-id", incomingRequestId)
      .expect(200);

    expect(res.headers["x-request-id"]).toBe(incomingRequestId);
    expect(res.body.requestId).toBe(incomingRequestId);
  });
});
