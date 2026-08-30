import { describe, it, expect, beforeEach, vi } from "vitest";
import RateLimiter, { apiRateLimiters, withRateLimit } from "../rate-limiter";

describe("RateLimiter", () => {
  let clock: number;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    clock = 0;
    rateLimiter = new RateLimiter(
      { maxRequests: 5, windowMs: 1000, getTime: () => clock },
      "test_limiter",
    );
  });

  it("allows requests within the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.checkLimit("key1");
      expect(result.allowed).toBe(true);
    }
  });

  it("rejects requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkLimit("key1");
    }
    const result = rateLimiter.checkLimit("key1");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets window after enough time passes", () => {
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkLimit("key1");
    }
    expect(rateLimiter.checkLimit("key1").allowed).toBe(false);

    clock += 1000;

    const result = rateLimiter.checkLimit("key1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("isolates per-key limits", () => {
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkLimit("key_a");
    }
    expect(rateLimiter.checkLimit("key_a").allowed).toBe(false);
    expect(rateLimiter.checkLimit("key_b").allowed).toBe(true);
  });

  it("reports correct remaining count", () => {
    const first = rateLimiter.checkLimit("key1");
    expect(first.remaining).toBe(4);

    rateLimiter.checkLimit("key1");
    const status = rateLimiter.getStatus("key1");
    expect(status.count).toBe(2);
    expect(status.remaining).toBe(3);
  });

  it("resets a specific identifier", () => {
    rateLimiter.checkLimit("key_a");
    rateLimiter.checkLimit("key_b");

    rateLimiter.reset("key_a");

    expect(rateLimiter.getStatus("key_a").count).toBe(0);
    expect(rateLimiter.getStatus("key_b").count).toBe(1);
  });

  it("resets all identifiers", () => {
    rateLimiter.checkLimit("key_a");
    rateLimiter.checkLimit("key_b");

    rateLimiter.reset();

    expect(rateLimiter.getStatus("key_a").count).toBe(0);
    expect(rateLimiter.getStatus("key_b").count).toBe(0);
  });

  it("clears stale entries on cleanup", () => {
    clock = 0;
    rateLimiter.checkLimit("stale_key");
    expect(rateLimiter.getStatus("stale_key").count).toBe(1);

    clock = 2000;
    const result = rateLimiter.checkLimit("stale_key");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });
});

describe("withRateLimit", () => {
  let clock: number;
  let limiter: RateLimiter;

  beforeEach(() => {
    clock = 0;
    limiter = new RateLimiter(
      { maxRequests: 3, windowMs: 1000, getTime: () => clock },
      "decorator_test",
    );
  });

  it("passes through successful calls within limit", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = withRateLimit(fn, limiter, "test_id");

    const result = await wrapped("arg1");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledWith("arg1");
  });

  it("throws when over limit", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = withRateLimit(fn, limiter, "test_id");

    await wrapped();
    await wrapped();
    await wrapped();

    await expect(wrapped()).rejects.toThrow("Rate limit exceeded");
  });

  it("uses identifier function", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const getId = (args: any[]) => String(args[0]);
    const wrapped = withRateLimit(fn, limiter, getId);

    await wrapped("user_1");
    await wrapped("user_1");
    await wrapped("user_1");

    await expect(wrapped("user_1")).rejects.toThrow("Rate limit exceeded");

    const result = await wrapped("user_2");
    expect(result).toBe("ok");
  });
});

describe("apiRateLimiters", () => {
  it("exports pre-configured limiters", () => {
    expect(apiRateLimiters.general).toBeDefined();
    expect(apiRateLimiters.auth).toBeDefined();
    expect(apiRateLimiters.sensitive).toBeDefined();
    expect(apiRateLimiters.upload).toBeDefined();
  });

  it("rate limits auth endpoint (5 req / 15 min)", () => {
    const auth = apiRateLimiters.auth;
    for (let i = 0; i < 5; i++) {
      expect(auth.checkLimit("test_user").allowed).toBe(true);
    }
    expect(auth.checkLimit("test_user").allowed).toBe(false);
  });
});
