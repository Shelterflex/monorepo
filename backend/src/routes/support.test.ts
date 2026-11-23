import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { rateLimitProfiles } from "../config/rateLimitConfig.js";
import { createSupportRouter, createAdminSupportRouter } from "./support.js";
import { errorHandler } from "../middleware/errorHandler.js";

// The real limiter is a no-op in NODE_ENV=test, so these tests supply a counting limiter that honours the profile's points.
const limiterFactory = vi.hoisted(() => vi.fn());

vi.mock("../middleware/rateLimiter.js", () => ({
  createRateLimiter: limiterFactory,
}));

// Authenticates from the x-test-user header, with the role taken from x-test-role (default tenant).
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
      email: "staff@example.test",
      name: "Staff",
      role: req.headers["x-test-role"] ?? "tenant",
    };
    next();
  },
}));

const validMessage = {
  name: "Ada Lovelace",
  email: "ada@example.test",
  subject: "Lease question",
  message: "When is my next instalment due?",
};

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/support", createSupportRouter());
  app.use("/api/v1/admin/support", createAdminSupportRouter());
  app.use(errorHandler);
  return app;
}

describe("support messages (#2056)", () => {
  let app: express.Application;

  beforeEach(() => {
    limiterFactory.mockReset();
    limiterFactory.mockImplementation((options: { points: number }) => {
      let hits = 0;
      return (_req: any, res: any, next: any) => {
        hits += 1;
        if (hits > options.points) {
          res.status(429).json({
            success: false,
            error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please slow down." },
          });
          return;
        }
        next();
      };
    });
    app = buildApp();
  });

  it("uses the supportMessage rate-limit profile for the public endpoint", () => {
    expect(limiterFactory).toHaveBeenCalledWith(rateLimitProfiles.supportMessage);
    expect(rateLimitProfiles.supportMessage).toMatchObject({ points: 5, duration: 3600, keyBy: "ip" });
  });

  it("accepts a valid submission without authentication and returns 201", async () => {
    const res = await request(app)
      .post("/api/v1/support/messages")
      .send(validMessage)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.messageId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("stores the submission and lists it for an admin", async () => {
    const before = await request(app)
      .get("/api/v1/admin/support/messages")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "admin")
      .expect(200);

    await request(app)
      .post("/api/v1/support/messages")
      .send({ ...validMessage, subject: "Unique subject for listing" })
      .expect(201);

    const after = await request(app)
      .get("/api/v1/admin/support/messages?pageSize=100")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "admin")
      .expect(200);

    expect(after.body.pagination.total).toBe(before.body.pagination.total + 1);
    const stored = after.body.data.find((m: { subject: string }) => m.subject === "Unique subject for listing");
    expect(stored).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.test",
      status: "new",
    });
  });

  it("trims surrounding whitespace before storing", async () => {
    await request(app)
      .post("/api/v1/support/messages")
      .send({ ...validMessage, name: "   Trimmed Name   ", subject: "  Trim check  " })
      .expect(201);

    const list = await request(app)
      .get("/api/v1/admin/support/messages?pageSize=100")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "admin")
      .expect(200);

    const stored = list.body.data.find((m: { subject: string }) => m.subject === "Trim check");
    expect(stored.name).toBe("Trimmed Name");
  });

  it.each([
    ["an invalid email", { email: "not-an-email" }],
    ["an empty message", { message: "" }],
    ["a message over 5000 characters", { message: "x".repeat(5001) }],
    ["a name over 255 characters", { name: "x".repeat(256) }],
    ["a phone over 20 characters", { phone: "1".repeat(21) }],
  ])("rejects %s with 400", async (_label, override) => {
    const res = await request(app)
      .post("/api/v1/support/messages")
      .send({ ...validMessage, ...override })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["the message", { message: "Hello <script>alert(1)</script>" }],
    ["the subject", { subject: "<b>Urgent</b>" }],
    ["the name", { name: "<img src=x onerror=alert(1)>" }],
  ])("rejects HTML in %s with 400", async (_label, override) => {
    await request(app)
      .post("/api/v1/support/messages")
      .send({ ...validMessage, ...override })
      .expect(400);
  });

  it("returns 429 for the sixth submission from one IP", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app).post("/api/v1/support/messages").send(validMessage).expect(201);
    }

    const res = await request(app).post("/api/v1/support/messages").send(validMessage).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("filters the admin list by status", async () => {
    await request(app)
      .post("/api/v1/support/messages")
      .send({ ...validMessage, subject: "Status filter check" })
      .expect(201);

    const newOnly = await request(app)
      .get("/api/v1/admin/support/messages?status=new&pageSize=100")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "admin")
      .expect(200);
    expect(newOnly.body.data.some((m: { subject: string }) => m.subject === "Status filter check")).toBe(true);
    expect(newOnly.body.data.every((m: { status: string }) => m.status === "new")).toBe(true);

    // Nothing has been moved to resolved, so this filter returns an empty page.
    const resolved = await request(app)
      .get("/api/v1/admin/support/messages?status=resolved")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "admin")
      .expect(200);
    expect(resolved.body.data).toEqual([]);
  });

  it("rejects an unknown status filter with 400", async () => {
    await request(app)
      .get("/api/v1/admin/support/messages?status=closed")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "admin")
      .expect(400);
  });

  it("returns 401 to unauthenticated admin requests and 403 to non-admins", async () => {
    await request(app).get("/api/v1/admin/support/messages").expect(401);

    await request(app)
      .get("/api/v1/admin/support/messages")
      .set("x-test-user", "tenant-1")
      .set("x-test-role", "tenant")
      .expect(403);
  });
});
