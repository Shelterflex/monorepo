import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../apiClient", () => ({ apiGet: vi.fn() }));

import { apiGet } from "../apiClient";
import { getRiskState, humanizeFreezeReason } from "../risk";

const getMock = vi.mocked(apiGet);

beforeEach(() => {
  getMock.mockReset();
});

describe("humanizeFreezeReason", () => {
  it("returns null for a missing or blank reason", () => {
    expect(humanizeFreezeReason(null)).toBeNull();
    expect(humanizeFreezeReason(undefined)).toBeNull();
    expect(humanizeFreezeReason("")).toBeNull();
    expect(humanizeFreezeReason("   ")).toBeNull();
  });

  it("turns SCREAMING_SNAKE_CASE into a sentence", () => {
    expect(humanizeFreezeReason("NEGATIVE_BALANCE")).toBe("Negative balance");
  });

  it("splits camelCase and hyphenated codes into words", () => {
    expect(humanizeFreezeReason("negativeBalance")).toBe("Negative balance");
    expect(humanizeFreezeReason("compliance-review")).toBe("Compliance review");
  });
});

describe("getRiskState", () => {
  it("reads /api/risk/state and normalises the payload", async () => {
    getMock.mockResolvedValueOnce({
      isFrozen: true,
      freezeReason: "NEGATIVE_BALANCE",
      deficitNgn: 2500,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(getRiskState()).resolves.toEqual({
      isFrozen: true,
      freezeReason: "Negative balance",
      deficitNgn: 2500,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/api/risk/state");
  });

  it("replaces malformed fields with safe defaults", async () => {
    getMock.mockResolvedValueOnce({ deficitNgn: "lots", updatedAt: 123 });

    await expect(getRiskState()).resolves.toEqual({
      isFrozen: false,
      freezeReason: null,
      deficitNgn: 0,
      updatedAt: null,
    });
  });

  it("falls back to /api/auth/me when the risk endpoint fails", async () => {
    getMock
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ user: { isFrozen: true, freezeReason: "MANUAL" } });

    await expect(getRiskState()).resolves.toEqual({
      isFrozen: true,
      freezeReason: "Manual",
      deficitNgn: 0,
      updatedAt: null,
    });
    expect(getMock.mock.calls.map((c) => c[0])).toEqual(["/api/risk/state", "/api/auth/me"]);
  });

  it("reports an unfrozen account when both endpoints fail", async () => {
    getMock.mockRejectedValue(new Error("down"));

    await expect(getRiskState()).resolves.toEqual({
      isFrozen: false,
      freezeReason: null,
      deficitNgn: 0,
      updatedAt: null,
    });
  });
});
