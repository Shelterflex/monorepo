import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFraudAssessments, fetchActiveHolds, releaseHold, toggleFraudSignal } from "@/lib/api/fraud";
import { ApiError } from "@/lib/api";

vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "@/lib/apiClient";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchFraudAssessments", () => {
  it("GETs assessments with no query when no decision is given", async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await expect(fetchFraudAssessments()).resolves.toEqual([]);
    expect(apiGet).toHaveBeenCalledWith("/api/admin/fraud/assessments");
  });

  it("adds the decision filter to the query string", async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await fetchFraudAssessments({ decision: "BLOCK" });

    expect(apiGet).toHaveBeenCalledWith("/api/admin/fraud/assessments?decision=BLOCK");
  });

  it("rejects with the ApiError on 401, 403 and 500", async () => {
    for (const status of [401, 403, 500]) {
      vi.mocked(apiGet).mockRejectedValueOnce(apiError(status));
      await expect(fetchFraudAssessments()).rejects.toMatchObject({ status });
    }
  });
});

describe("fetchActiveHolds", () => {
  it("GETs the holds route", async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await fetchActiveHolds();

    expect(apiGet).toHaveBeenCalledWith("/api/admin/fraud/holds");
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(403));

    await expect(fetchActiveHolds()).rejects.toMatchObject({ status: 403 });
  });
});

describe("releaseHold", () => {
  it("POSTs the reason to the hold's release route", async () => {
    vi.mocked(apiPost).mockResolvedValue({});

    await releaseHold("hold-1", "cleared by review");

    expect(apiPost).toHaveBeenCalledWith("/api/admin/fraud/holds/hold-1/release", {
      reason: "cleared by review",
    });
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(releaseHold("hold-1", "x")).rejects.toMatchObject({ status: 500 });
  });
});

describe("toggleFraudSignal", () => {
  it("POSTs to the enable route when enabled is true", async () => {
    vi.mocked(apiPost).mockResolvedValue({});

    await toggleFraudSignal("sig-1", true);

    expect(apiPost).toHaveBeenCalledWith("/api/admin/fraud/signals/sig-1/enable", {});
  });

  it("POSTs to the disable route when enabled is false", async () => {
    vi.mocked(apiPost).mockResolvedValue({});

    await toggleFraudSignal("sig-1", false);

    expect(apiPost).toHaveBeenCalledWith("/api/admin/fraud/signals/sig-1/disable", {});
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(403));

    await expect(toggleFraudSignal("sig-1", true)).rejects.toMatchObject({ status: 403 });
  });
});
