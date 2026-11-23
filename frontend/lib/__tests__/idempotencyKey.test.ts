import { describe, it, expect, vi, afterEach } from "vitest";
import { newIdempotencyKey } from "../idempotencyKey";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newIdempotencyKey", () => {
  it("returns an RFC 4122 v4 UUID", () => {
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });

  it("returns a different key on every call", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(1000);
  });

  it("builds a valid v4 UUID from getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xff);
        return bytes;
      },
    });

    const key = newIdempotencyKey();
    expect(key).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(key).toMatch(UUID_V4);
  });

  it("fails closed when no secure random source exists", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => newIdempotencyKey()).toThrow(/No secure random source/);
  });
});
